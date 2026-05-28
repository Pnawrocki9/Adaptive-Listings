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

## RETRO-003 — TICKET-REORDER-001 (ReorderDirective DOM reorder + grid re-ranking) — 2026-05-14

**Note:** Retroactive retro. PR #91 merged 2026-05-14 (commit `40650aa`), part of the Sprint 8
fix-cluster. This retro runs after RETRO-001 (TICKET-046) and RETRO-002 (TICKET-AB-001) per the PM's
retroactive ordering. Both prior retros explicitly noted "no impact" on REORDER-001 — this retro
confirms the inverse direction (REORDER-001 → others) was not yet assessed and finds several
outbound cascading effects, plus one P0 wiring gap that mirrors the Rule H pattern.

### 1. Summary of change

- **PR:** #91 (merged 2026-05-14, commit `40650aa`)
- **Files changed:** 6 (+519 / -18)
- **Modules touched:** SDK core (`packages/sdk/src/core/adapt.ts`), control-plane Decision API
  (`apps/control-plane/src/app/api/adapt/route.ts` + tests), demo page
  (`apps/control-plane/src/app/dashboard/demo/mockup/page.tsx`), commitlint config
- **Key contracts changed:**
  - `applyDirectives()` signature — CHANGED from `(TextDirective | ClassDirective)[]` to
    `(TextDirective | ClassDirective | ReorderDirective)[]` — breaking: no (`ReorderDirective` was
    already defined in `packages/shared/src/directives.ts` since Sprint 7.5; the SDK union type was
    the lagging consumer). Existing callers compile unchanged because the union widened.
  - `AdaptResponse.directives` (SDK side, `packages/sdk/src/core/adapt.ts:37`) — CHANGED to the same
    widened union — breaking: no for consumers that already typed against the shared union.
  - `AdaptPostBodySchema.listing_ids: z.array(z.string().max(64)).max(100).optional()` — ADDED to
    `apps/control-plane/src/app/api/adapt/route.ts:61` — breaking: no (additive).
  - `POST /api/adapt` response body — now MAY include a `ReorderDirective` in the `directives` array
    when `tenant_id === 'est_demo_tenant'` AND `listing_ids` non-empty — breaking: no (additive
    within the existing union).
  - New module-private helpers in `apps/control-plane/src/app/api/adapt/route.ts`:
    `getTenantSchema()`, `deterministicScore()`, `buildReorderDirective()`, `TenantSchema` interface
    — NOT exported; no public-surface change.
  - Demo page: `data-estalara-listings-grid` attribute added to the grid container at
    `apps/control-plane/src/app/dashboard/demo/mockup/page.tsx:119`.
  - `commitlint.config.cjs` — ADDED `REORDER-` to the allowed ticket-prefix regex.

### 2. Verification done in PR

- Test files changed/added:
  - `packages/sdk/src/__tests__/adapt.test.ts` (+206 lines, 6 new
    `applyDirectives — ReorderDirective` cases at lines 694–871): descending sort,
    cards-without-id-go-to-end, `pin_top_n`, idempotency (same `container + archetype` fingerprint
    is no-op on second call), missing-container `adapt.skipped {reason: no_container}`, empty item
    list `adapt.skipped {reason: no_cards}`.
  - `apps/control-plane/src/app/api/adapt/route.test.ts` (+120 lines, 5 new POST cases at lines
    849–954): `est_demo_tenant + listing_ids` returns 1 ReorderDirective with correct selectors; no
    `listing_ids` → 0 reorders; empty `listing_ids` → 0 reorders; non-demo tenant → 0 reorders
    (gating on `reorder_capable` works); scores sorted descending; >100 `listing_ids` → 400.
    Includes new `ReorderDirectiveSchema` Zod block (lines 86–95) used in
    `AdaptationDirectivesSchema` union.
- Assertions added: ~25 across the two test files.
- Coverage delta: `applyReorderDirective` branch of `packages/sdk/src/core/adapt.ts` exercised for
  both happy-path and 2 fail-safe branches; POST route's reorder appendage logic exercised at all
  four tenant/`listing_ids` permutations.
- CI checks: per QUEUE.md `recent-merges` entry, marked DONE 2026-05-14 (no CI failures noted).
- **NOT verified by tests:**
  - End-to-end test that the SDK `fetchDirectives()` → POST adapt → SDK `applyDirectives()` → DOM
    reorder full loop works against the demo page (only unit-level pieces tested in isolation).
  - That `apps/decision-api/src/app/api/adapt/route.ts` (the real Worker-style decision API) does
    NOT produce ReorderDirectives despite accepting `listing_ids` in its Zod schema (`route.ts:39`)
    — see Section 3a.
  - That holdout-group sessions do NOT receive ReorderDirectives (the control-plane POST has NO
    holdout logic at all — see Section 3a / 4c).
  - Tier gating: POST always sets `tier: 1` (`route.ts:505`) even when a Tier 2 capability
    (ReorderDirective) is being served — see Section 3a.

### 3. Discovered gaps

#### 3a. Logic gaps

- **DECISION-API DOES NOT EMIT REORDER DIRECTIVES (P0, mirror of Rule H).** The real Decision API at
  `apps/decision-api/src/app/api/adapt/route.ts` accepts
  `listing_ids: z.array(z.string()) .optional()` at `route.ts:39` but the field is destructured
  nowhere and never used to build a ReorderDirective. Only the control-plane mock POST at
  `apps/control-plane/src/app/api/adapt/route.ts` ships the reorder logic — and that is the demo
  endpoint. So in any production wiring where the SDK points `decisionApiUrl` at the Worker
  (`apps/decision-api`), reorder will silently never happen. The `listing_ids` schema field is
  scaffold-only on the production code path. **This is the same pattern Rule H codifies** — schema
  field added, no wiring on the production hot path. Confirmed by
  `grep -n "listing_ids" apps/decision-api/src/app/api/adapt/route.ts` → 1 match (schema declaration
  only). → FOLLOW-015 (P0, backend-engineer, 4h).
- **TIER ALWAYS 1 IN POST RESPONSE WHILE SERVING TIER-2 CAPABILITY (P1).** The control-plane POST
  handler hardcodes `tier: 1` at `route.ts:505` in the `AdaptationDirectives` response, even when it
  appends a `ReorderDirective`. Per Master Design B.x and the integration-tier definition in
  CLAUDE.md, DOM mutation (which reorder IS) is a **Tier 2 Augment** capability. Tier 1 is read-only
  sidebar. The SDK does not currently gate `applyDirectives()` by tier (it would apply a
  ReorderDirective regardless of the response's tier field), so this is not a runtime blocker — but
  it makes per-tier billing and analytics queries (AB-004 dashboard, future pricing meter) attribute
  reorder impressions to the wrong tier. → FOLLOW-016 (P1, backend-engineer, 1h).
- **HOLDOUT GROUP IS NOT HONORED IN CONTROL-PLANE POST (P0).** `apps/decision-api/route.ts` enforces
  "holdout sessions receive default-experience, no directives" (lines 292–302). The control-plane
  POST endpoint that REORDER-001 modified has NO call to `assignHoldout()` and NO holdout gating —
  so any client routed through the POST endpoint (currently the demo page) will receive
  ReorderDirectives even if the same session would have been in the holdout arm on the Worker route.
  This breaks A/B comparability. Combined with the previous gap, the situation is: Worker route
  holds out but emits no reorder anywhere; control-plane POST emits reorder but ignores holdout
  entirely. → FOLLOW-017 (P0, backend-engineer, 2h — depends on FOLLOW-015's consolidation choice).
- **HARDCODED DEMO TENANT TABLE (P2).** `getTenantSchema()` at
  `apps/control-plane/src/app/api/adapt/route.ts:214` matches a string literal `'est_demo_tenant'`
  and returns `null` for any other tenant. Per the ticket spec notes ("Real tenants will get this
  from a DB lookup (REORDER-002)") this is acknowledged scaffold, but there is NO follow-up stub for
  REORDER-002 in `backlog/FOLLOW_UPS.md` and the comment is the only forward reference. This is the
  same anti-pattern Rule H paragraph 2 already calls out ("Mock API routes are allowed only when (3)
  [explicit dated deferral + FOLLOW-NNN stub] is satisfied"). → FOLLOW-018 (P2, sdk-engineer +
  backend-engineer, 4h — wires `getTenantSchema()` to read `IndexSchema` from the tenant config
  table populated by auto-detect output).
- **SCORE FUNCTION IS A DETERMINISTIC HASH, NOT ARCHETYPE AFFINITY (P1).** Despite the directive
  field `score_function: 'archetype_affinity'`, the underlying `deterministicScore()` at
  `route.ts:229–236` is `((hash * 31 + charCode) >>> 0) % 10000 / 10000` over the string
  `${archetype}:${listing_id}`. There is no listing-content lookup, no archetype-feature matching,
  no embedding similarity, no recency/popularity prior. The "archetype affinity" name is correct
  only to the extent that the same (archetype, listing_id) pair always returns the same hash — but
  that just makes ordering stable, not meaningful. AB-004's "Top adaptation types" panel will
  measure CTR lift against essentially random reordering. → FOLLOW-019 (P1, ml-engineer, 6h — feed
  real archetype-affinity scores from `tenant_listings.archetype_scores` table, or from a Modal job
  similar to the embeddings pipeline).
- **REFRESH-ON-INTENT-UPDATE BYPASSES IDEMPOTENCY (P2).** `packages/sdk/src/index.ts:126` calls
  `resetAdaptState()` before every `applyDirectives()` invocation in `refreshDirectives()`. This
  clears `appliedFingerprints` set, including the reorder fingerprint
  `reorder:${container_selector}:${archetype}`. As intent confidence drifts within a session,
  successive refreshes will re-run the reorder. With a stable `archetype` this is harmless (the sort
  is order-preserving), but if `archetype` changes (the typical case during a session — e.g.
  `neutral` → `yield_hunter` after enough behavioral signal), the new sort will reorder cards AGAIN,
  producing visible flicker. The unit test at `adapt.test.ts:786` exercises idempotency WITHOUT
  calling `resetAdaptState()` — so the test passes but the realistic SDK call sequence does not. →
  FOLLOW-020 (P2, sdk-engineer, 1.5h — move the reset-state-on-refresh decision out of `index.ts`,
  or scope the fingerprint to session only, not per-refresh).

#### 3b. Code bugs not caught

- **`pin_top_n` BREAKS IDEMPOTENCY FINGERPRINT CARDINALITY (P3, latent).** The idempotency
  fingerprint at `packages/sdk/src/core/adapt.ts:205` is
  `reorder:${container_selector}:${archetype}` — it omits `pin_top_n`. If the directive ever changes
  `pin_top_n` (e.g. archetype warmed up from "pin top 2" to "pin top 5" via a server config change),
  the second `applyDirectives()` call will be a no-op even though the desired result has changed.
  **Severity P3** because today no consumer changes `pin_top_n` mid-session, but combined with the
  refresh-bypass above, this could mask reordering intent. Flag for visibility — folded into
  FOLLOW-020.
- **CARDS APPENDED IN A LOOP WITHOUT DOM-FRAGMENT BATCHING (P3, perf).** `applyReorderDirective` at
  lines 223 and 226 uses `container.prepend(...topCards)` and `container.append(...sorted)`. For
  lists of 50+ cards this triggers N layout reflows; a `DocumentFragment` build-then-append would do
  a single reflow. The 50-id cap from `fetchDirectives()` (`adapt.ts:306`) bounds this, but it is
  still a measurable Cumulative Layout Shift on first paint for large grids. Flag for visibility;
  not creating a follow-up (premature optimization at current scale).
- **POST RETURNS `tier: 1` WITH NO INPUT VALIDATION OF TIER (P2).** `AdaptPostBodySchema` does not
  accept a `tier` field, so the SDK cannot signal its actual integration tier when calling POST. The
  Worker route accepts tier via GET query string. This means: (a) any tenant on a Tier 2 contract
  using the demo/POST path is invisible in analytics, (b) when the production wiring unifies
  (FOLLOW-015), the POST signature will need to take `tier` and the response will need to honor it.
  Folded into FOLLOW-015 + FOLLOW-016 (do not split further).

#### 3c. Test coverage gaps

- **No test that asserts holdout sessions receive NO ReorderDirective.** The control-plane POST has
  no holdout path at all (see 3a), so this test cannot be written today — but once FOLLOW-017 lands,
  an integration test of the shape
  `forcedHoldout(session) → POST → expect directives.filter(d => d.type === 'reorder').length === 0`
  is required. Add to FOLLOW-017 AC.
- **No corpus regression test that REORDER does not break auto-detected schemas.** The ticket notes
  say "Requires: corpus CI gate stays green after DOM reorder changes (rerun pnpm test:corpus)" —
  but the PR includes no new corpus fixture that exercises a reordered grid, and there is no
  assertion in `corpus.test.ts` that `applyReorderDirective` can run against every detected
  `IndexSchema` shape across the 15+ corpus sites without error. → FOLLOW-021 (qa-engineer, 2h —
  extend corpus test to apply a synthetic ReorderDirective and assert zero `adapt.skipped` events on
  `reorder_capable: true` fixtures).
- **No integration test that the SDK actually sends `listing_ids` AND the server actually returns a
  reorder matching them.** Both ends are unit-tested independently. End-to-end MSW or Playwright
  assertion that POSTs to a mock server and verifies the DOM reorders to the server-ordered scores
  is missing. → FOLLOW-022 (qa-engineer, 3h).
- **No test for archetype mismatch between SDK request and server response.** If SDK sends
  `archetype_hint: 'family_buyer'` but server scores by `yield_hunter` (because of a server
  override), the SDK still applies the directive — and the resulting fingerprint uses the server's
  archetype, not the SDK's. There is no assertion that the response's `archetype` matches the
  directive's `archetype` field. → covered as a sub-AC of FOLLOW-019 (P1).
- **No assertion of stability across two POSTs from the same session.** `deterministicScore()` is
  deterministic in principle, but no test asserts that POSTing the same
  `(tenant_id, archetype, listing_ids)` body twice returns identical `scores` arrays. → folded into
  FOLLOW-019 AC.

#### 3d. Documentation gaps

- **`docs/MASTER_DESIGN.md` does not document the "ReorderDirective only on est_demo_tenant"
  demo-mode boundary.** Master Design B.9 + E.2 describe reorder as a Tier 2 capability available to
  all reorder-capable tenants. The current shipping behavior is demo-tenant-only. Without an
  explicit status note, a future agent reading B.9 will assume all tenants get reorder. → FOLLOW-023
  (architect, 0.5h — add a status note next to E.2 / B.9.2 pointing at FOLLOW-018 for the DB-backed
  lookup).
- **No ADR for `score_function` extensibility.** The directive literal
  `score_function: 'archetype_affinity'` is currently a single-element union but is typed as such,
  blocking future scoring functions (e.g. `'engagement_blend'`, `'recency_weighted'`) without a
  breaking type change. An ADR documenting that this field is a sealed enum and the versioning
  strategy for adding new scoring functions would prevent that surprise. Minor — not creating a
  follow-up; flag for the ml-engineer when they pick up FOLLOW-019.
- **`packages/shared/src/directives.ts` docstring still says "SPRINT 8 HOOK: ReorderDirective. Full
  DOM implementation in Sprint 8 (A/B framework + re-ranking)."** This is now stale — the
  implementation HAS shipped. The docstring needs to be updated to point to the SDK consumer and to
  FOLLOW-019/FOLLOW-015 for the remaining wiring gaps. → folded into FOLLOW-023 (architect can
  update both in one pass).

### 4. Cascading impact

#### 4a. Current sprint tickets affected

- **TICKET-AB-004 (DONE, PR #99) — "Top adaptation types" panel reads from
  `adaptation_decisions.directive_count`.** With REORDER-001 shipping, the demo POST adds one more
  directive per request (when `listing_ids` present + demo tenant), so `directive_count` for the
  demo tenant jumps by 1. AB-004 panel queries that bucket `directive_count` will see a new
  distribution mode. No code break, but the panel's calibration needs to be re-baselined once
  non-demo tenants also produce reorders (after FOLLOW-018). Add note to AB-004 dashboard docs.
- **TICKET-AB-001 (DONE, PR #80) — holdout consistency.** RETRO-002 noted REORDER-001 was
  "independent of bandit selection; no impact" — that remains true at the variant_index level
  (reorder doesn't carry a variant_index), but the control-plane POST endpoint REORDER-001 modified
  does NOT honor holdout assignment AT ALL. This is the inverse of the assumption RETRO-002 made
  (that the Worker route is the only emission point — but the demo POST is now a second emission
  point that bypasses AB infrastructure). See Section 3a → FOLLOW-017. This is a **direct
  contradiction between two prior retro conclusions** and should be flagged: both RETRO-001 §4a and
  RETRO-002 §4a said "REORDER-001: no impact / clean." Neither analyst inspected the control-plane
  POST endpoint's holdout behavior because the analysis went REORDER-001 → AB-001 (one direction)
  without the inverse pass. RETRO-003 fixes that.
- **TICKET-046 (DONE, PR #92) — copy variants.** Confirmed clean — REORDER reorders cards, not text
  content, and does not read or interact with `SlotDirective.variants` or
  `PlaybookEntry.copy_template`. No new gap.
- **TICKET-AGENCY-001 (DONE, PR #97) — agency answers RAG.** Confirmed clean — RAG pipeline feeds
  `listingContext` into `runDecisionTree()`, which produces TextDirectives only. The
  ReorderDirective is appended AFTER `runDecisionTree()` returns (`route.ts:481`) and uses no RAG
  output. No coupling.

#### 4b. Future sprint tickets affected

- **TICKET-NATIVE-001 (BLOCKED, depends_on: [TICKET-REORDER-001]).** Per QUEUE.md notes, this ticket
  explicitly relies on REORDER-001: "AI Topics reordering (B.9.2): ReorderDirective drives tag
  reorder per archetype (yield_hunter → Rental/ROI/Transport first; family_buyer → Schools/Parks
  first)." But NATIVE-001 is a Tier 3 SvelteKit integration targeting `app.estalara.com` — there,
  the tenant_id will be Estalara's own production tenant (`est_estalara_prod` or similar), NOT
  `est_demo_tenant`. With the hardcoded demo-only `getTenantSchema()`, REORDER would return no
  directive for the Estalara native app once NATIVE-001 wires real traffic. NATIVE-001 cannot
  succeed until FOLLOW-018 (real tenant schema lookup) lands. **Action:** PM should update
  TICKET-NATIVE-001's `depends_on` list from `[TICKET-REORDER-001]` to
  `[TICKET-REORDER-001, FOLLOW-018]` so the dependency reflects real shippability.
- **TICKET-CAUSAL-001 (Sprint 8 BACKLOG, P2) — CATE per archetype.** Causal estimation requires a
  real treatment signal, not a hash-randomized one. With `deterministicScore()` as the current
  scorer (gap 3a), reorder is treatment-noise: CATE will measure CTR lift of
  "card-order-hash-mod-10000" against the holdout, not "archetype-affinity-driven order" against
  holdout. CAUSAL-001's downstream conclusions will be invalid until FOLLOW-019 lands. Add
  CAUSAL-001 blocker: FOLLOW-019 + FOLLOW-017 + AB-001's FOLLOW-010.
- **TICKET-DESC-001 (Sprint 9 BACKLOG, P1) — long-form description pipeline.** No direct dependency
  — DESC-001 generates TextDirective content via Sonnet; reorder is orthogonal. Clean.
- **TICKET-VAL-001 (Sprint 9 BACKLOG, P1) — schema validation cron.** Indirect: VAL-001 will detect
  drift in `IndexSchema.container_selector` / `item_selector` per tenant. Once FOLLOW-018 lands and
  reorder reads from tenant config, VAL-001's drift alerts must include "container_selector no
  longer resolves" as a P0 alert (reorder will fail silently with
  `adapt.skipped {reason: no_container}`). Add to VAL-001 spec.
- **TICKET-GDPR-004 (Sprint 9 BACKLOG, P0) — consent-aware skip.** Reorder is a behavioral
  personalization just like text rewriting, so the same consent gate applies. Once FOLLOW-017 wires
  holdout into the POST, the same handler must also honor `consent_state` skip per AB-001 §AC-3.
  Single coordinated change — fold into FOLLOW-017 + reference from GDPR-004 spec.

#### 4c. Contracts changed that other modules rely on

- **`AdaptPostBodySchema.listing_ids` (new optional field).** Cross-app implication: the SDK
  (`packages/sdk/src/core/adapt.ts:309`) collects up to 50 `[data-estalara-listing-id]` elements and
  sends them in the body. The control-plane POST consumes this with a max of 100 (`route.ts:61`).
  The **Worker decision-api route also declares the same field**
  (`apps/decision-api/src/app/api/adapt/route.ts:39`) with NO max constraint and does nothing with
  it. Two different validation rules on the same field across two services is a cross-app contract
  divergence. → folded into FOLLOW-015.
- **`(TextDirective | ClassDirective | ReorderDirective)[]` union in SDK `AdaptResponse`.** Any
  downstream code that exhaustively pattern-matches on `directive.type` (sidebar widget, preview
  panel, future Tier 1 Observer) MUST be re-audited to handle `'reorder'`. The preview-panel filter
  at `packages/sdk/src/index.ts:139` only consumes `'text'` types — so the sidebar will silently
  drop reorders, which is correct behavior (sidebar is read-only). No bug, but worth a one-line
  comment explaining the intentional drop. Minor — fold into FOLLOW-023.
- **Demo page `data-estalara-listings-grid` attribute (single occurrence).** Any future redesign of
  `apps/control-plane/src/app/dashboard/demo/mockup/page.tsx` MUST preserve this attribute or the
  demo will stop reordering with no error message (skip event reason `no_container`). A test
  asserting the attribute exists on the mockup page would prevent silent regression. → folded into
  FOLLOW-022.

#### 4d. Architectural assumptions affected

- **Master Design B.9 + E.2 describe reorder as a Tier 2 capability available to any tenant whose
  `IndexSchema.reorder_capable === true`.** Shipped behavior is demo-tenant-only + hardcoded
  selectors + hash-randomized scoring. The architecture is sound; the wiring is incomplete — the
  SAME shape Rule H already codifies from RETRO-001 + RETRO-002. **This is now a third confirmed
  instance of the Rule H pattern** (schema + scaffold complete, runtime wiring deferred):
  variant_index (RETRO-001 FOLLOW-001), bandit selection (RETRO-002 FOLLOW-007), and now per-tenant
  reorder lookup (RETRO-003 FOLLOW-018). Rule H is correctly promoted; no new rule needed — but the
  pattern's stubborn recurrence suggests the PM's PR-review checklist for Rule H verification
  (`grep -rn '<symbol_name>' apps/ … must return ≥1 match outside the defining file`) is not being
  executed pre-merge. Recommend PM make Rule H verification a hard pre-merge gate (not advisory). →
  FOLLOW-024 (architect, 0.5h — add the Rule H check to the PM's pre-READY_FOR_REVIEW checklist in
  `docs/AGENT_WORKFLOW.md`).
- **Three-tier integration model (Master Design / CLAUDE.md):** "Tier 1 Observer — read-only sidebar
  widget, no DOM mutation." The control-plane POST endpoint returns `tier: 1` alongside a
  ReorderDirective. A naïve reading of "Tier 1 = no DOM mutation" would say this violates the tier
  contract. The reality is that the SDK consumer does not currently gate `applyDirectives()` by tier
  — so the tier field is metadata, not an enforcement boundary. This needs to be explicit in the
  architecture: either (a) tier becomes purely descriptive for billing/analytics (and we update
  CLAUDE.md to say so), or (b) the SDK begins to filter directives by tier (which would break the
  demo today). → FOLLOW-016 (P1).
- **Fair-housing escalation (ESCALATIONS.md, 2026-05-13):** The CEO's resolution unblocked
  REORDER-001 with the binding caveat that archetypes remain purely behavioral. Reorder shipped with
  no proxy-demographic signal — confirmed clean. The caveat needs to be re-enforced as a pre-merge
  check when FOLLOW-019 (real archetype-affinity scoring) lands, because that ticket will introduce
  new scoring features that COULD inadvertently encode proxy-demographics (e.g. zip-code priors,
  school district scoring). Add the binding caveat reminder to FOLLOW-019's spec AC list.

### 5. New lesson candidates

- **Pattern: "Schema/scaffold complete, runtime wiring deferred — no test asserts the wiring
  exists"** — Rule H. RETRO-001 + RETRO-002 = 2 retros → already promoted. This retro adds a **third
  instance** (`listing_ids` field declared in `apps/decision-api/route.ts` schema, never consumed).
  Count: 3 retros, ≥6 distinct instances now. Rule H stands. Recommendation: STRENGTHEN Rule H by
  making the grep check a hard pre-merge gate (not advisory) — but this is a tooling improvement,
  not a new rule. Captured as FOLLOW-024 instead of a new rule entry.
- **Pattern: "Demo tenant hardcoded in production route file with no FOLLOW-NNN reference"** — seen
  in RETRO-003 only (`getTenantSchema()` matches `'est_demo_tenant'` literal at
  `apps/control-plane/src/app/api/adapt/route.ts:215`). Count: 1 retro. **Threshold: 2 — NOT YET
  met.** Track for next retro. Note: Rule H §2 already covers "Mock API routes are allowed only when
  (3) is satisfied" — this is a sub-case of Rule H; if it recurs, consider amending Rule H
  verification rather than adding a new rule.
- **Pattern: "Two services accept the same Zod field with divergent validation rules"**
  (`listing_ids` max 100 in control-plane, no max in decision-api) — seen in RETRO-003 only.
  Count: 1. **Threshold: 2 — NOT YET met.** Track.
- **Pattern: "Tier field hardcoded in response despite serving cross-tier capability"** — seen in
  RETRO-003 only. Count: 1. **Threshold: 2 — NOT YET met.** Track.

**No new rule promoted in this retro.** Rule H continues to absorb the dominant recurring pattern;
the new patterns above need ≥2 retros each before promotion. Rules A–H remain canonical.

### 6. Follow-ups

- FOLLOW-015: Wire ReorderDirective into the production decision-api Worker route (consume
  `listing_ids`, build the directive, consolidate validation with control-plane) (backend-engineer,
  4h, P0, Sprint 8 immediate)
- FOLLOW-016: Honor `tier` in POST /api/adapt response (accept tier in body, return it faithfully;
  document tier-vs-directive-type relationship) (backend-engineer, 1h, P1, Sprint 8)
- FOLLOW-017: Add holdout gating + consent skip to control-plane POST /api/adapt — no
  ReorderDirective for holdout-arm or non-consenting sessions (backend-engineer, 2h, P0, Sprint 8
  immediate — depends on FOLLOW-015 consolidation choice)
- FOLLOW-018: Replace `getTenantSchema()` hardcoded `est_demo_tenant` with DB lookup against
  auto-detect output (`IndexSchema.container_selector` / `item_selector` / `reorder_capable`)
  (sdk-engineer + backend-engineer, 4h, P2, Sprint 9 — unblocks NATIVE-001)
- FOLLOW-019: Real archetype-affinity scoring — replace `deterministicScore()` hash with
  `tenant_listings.archetype_scores` lookup or Modal embedding-similarity job (ml-engineer, 6h, P1,
  Sprint 9 — fair-housing caveat binds: no proxy-demographic features)
- FOLLOW-020: Move `resetAdaptState()` out of per-refresh path in SDK index.ts (or scope reorder
  fingerprint to session only) to prevent re-reorder flicker on intent change (sdk-engineer, 1.5h,
  P2, Sprint 8)
- FOLLOW-021: Corpus test — apply a synthetic ReorderDirective to every `reorder_capable: true`
  corpus fixture and assert zero `adapt.skipped` (qa-engineer, 2h, P2, Sprint 8 or 9)
- FOLLOW-022: End-to-end integration test for SDK→POST→DOM reorder (MSW or Playwright); asserts
  `[data-estalara-listings-grid]` attribute exists on the demo page (qa-engineer, 3h, P2, Sprint 9)
- FOLLOW-023: Documentation pass — update `docs/MASTER_DESIGN.md` E.2/B.9.2 with implementation-
  status note pointing at FOLLOW-018; update `packages/shared/src/directives.ts` ReorderDirective
  JSDoc to remove the "SPRINT 8 HOOK" stale note (architect, 0.5h, P3, Sprint 8 or 9)
- FOLLOW-024: Promote Rule H verification (`grep -rn <symbol> apps/ …`) from advisory to hard
  pre-merge gate in PM-orchestrator workflow — update `docs/AGENT_WORKFLOW.md` (architect, 0.5h, P1,
  Sprint 8 — addresses recurrence of Rule H in 3 consecutive retros)

### 7. Cross-references

- **RETRO-001 (TICKET-046):** §4a stated "TICKET-REORDER-001 (DONE): No impact — reorder logic
  doesn't use variants or copy_template." Confirmed for the variants/copy_template axis but
  RETRO-001 did not inspect the inverse direction (REORDER-001's effects on variants pipeline) — no
  new finding there. RETRO-001's FOLLOW-001 (variant_index unwired) is unrelated to REORDER (reorder
  carries no variant_index). No fold required.
- **RETRO-002 (TICKET-AB-001):** §4a stated "TICKET-REORDER-001 (DONE, PR #91): Independent of
  bandit selection; no impact. ReorderDirective uses archetype-keyed reorder rules, not variant
  indices. Confirmed clean." **This retro finds that statement was correct on the variant_index axis
  but INCOMPLETE on the holdout axis** — the control-plane POST endpoint REORDER-001 modified has no
  holdout logic at all (Section 3a). The two retros taken together correctly identify that the
  _Worker_ decision-api route and the _control-plane_ POST route are two separate emission paths
  with separate gaps: Worker holds out but emits no reorder (FOLLOW-015); control-plane POST emits
  reorder but ignores holdout (FOLLOW-017). Fixing both is a coordinated effort — likely a single
  follow-up sprint to unify the two routes' adapt logic. **Recommend PM consider a SPIKE ticket to
  evaluate whether the demo POST and the Worker GET/POST should share an internal
  `runDecisionPipeline()` library.**
- **CONVENTIONS_PATCH.md Rule H:** Third confirmed instance of the "schema scaffold + deferred
  wiring" pattern this retro. Rule stands. Verification hardening proposed via FOLLOW-024 (process
  improvement, not rule amendment).
- **ESCALATIONS.md (Fair-housing resolution, 2026-05-13):** Binding caveat (archetypes must remain
  purely behavioral) is honored by REORDER-001 as shipped. Caveat re-flagged in FOLLOW-019 AC
  because the real-scoring follow-up could inadvertently introduce proxy-demographic features if not
  carefully designed.

---

## RETRO-004 — TICKET-046 (playbook variants + copy_template) — 2026-05-14

**Note:** Deep re-analysis of TICKET-046 / PR #92. RETRO-001 (the original retro) was authored
before RETRO-002 (AB-001) and RETRO-003 (REORDER-001) surfaced the dominant "Rule H" pattern.
RETRO-004 re-examines PR #92 with that lens — and with knowledge of how `variant_index` is (not)
propagated by AB-001, how `listingContext` actually flows through the LLM gateway, and how Master
Design v1.6's E.6/E.7 sections map (or fail to map) onto shipped code. Findings here are explicitly
things RETRO-001 missed or under-scoped, plus repeating patterns that should strengthen Rule H or be
codified as a separate Rule.

### 1. Summary of change

- **PR:** #92 (merged 2026-05-14, commit `b6368b6`)
- **Files changed:** ~30 (+817 / -40) — confirmed against RETRO-001 §1
- **Modules touched:** SDK playbooks (17 non-neutral archetypes + types + tests), control-plane
  `llm-gateway.ts`, control-plane `llm-gateway.test.ts` MOCK_PLAYBOOK, demo mockup page,
  `docs/MASTER_DESIGN.md` v1.4 → v1.6 (E.6/E.7 added)
- **Key contracts changed (re-confirmed + additions RETRO-001 missed):**
  - `PlaybookEntry.copy_template` — ADDED as REQUIRED field (`copy_template: { en; pl?; es? }`) —
    breaking: yes for any inline `PlaybookEntry` mock (Rule G hit; only `MOCK_PLAYBOOK` in
    `llm-gateway.test.ts` updated)
  - `SlotDirective.variants` — ADDED as OPTIONAL field
    (`variants?: { en: string[]; pl?: string[]; es?: string[] }`) — breaking: no
  - Slot rename: `feature-section` → `feature` in `yield-hunter.ts` and `llm-gateway.ts` Sonnet
    prompt — breaking: yes for any consumer hard-coding the old name (Rule F evidence)
  - Master Design **E.6 (Placeholder Resolution Order, 7-level hierarchy)** — ADDED v1.6 — there is
    NO corresponding code change implementing the 7-level hierarchy; `interpolatePlaceholders()` in
    `packages/sdk/src/core/adapt.ts:87` still only checks one source (`data-estalara-<token>` DOM
    attribute) → RETRO-001 did not flag this as a Rule H instance
  - Master Design **E.7 (Long-form Description Pipeline)** — ADDED v1.6 — no endpoint, no Modal job,
    no Redis cache shipped (RETRO-001 §3a flagged this as FOLLOW-002; still open)
  - `TextDirective` in `packages/shared/src/directives.ts:46` — UNCHANGED — does NOT carry
    `variant_index`, even though E.3 (v1.6) declares it will (RETRO-001 §3a flagged the seed gap but
    did NOT call out the missing field on the shared type itself — required for FOLLOW-001/007 to
    even type-check)
  - `MOCK_PLAYBOOK` in `apps/control-plane/src/lib/__tests__/llm-gateway.test.ts:48` — partially
    updated: `copy_template.en` added, BUT the mock's headline slot does NOT include `variants`
    (slot is type-valid since `variants` is optional, but the mock is now non-representative of any
    real non-neutral archetype shipped in this PR) — RETRO-001 missed this divergence

### 2. Verification in PR

(Re-confirms RETRO-001 §2 with one correction.)

- Test files changed: `packages/sdk/src/__tests__/playbooks.test.ts` (path corrected — RETRO-001
  listed `packages/sdk/src/core/playbooks/__tests__/playbooks.test.ts`; actual file is one level up
  at `packages/sdk/src/__tests__/playbooks.test.ts`). 18 archetypes × ~6 invariants. Two new
  assertions are particularly load-bearing:
  - `playbooks.test.ts:97-98`: every non-neutral archetype's `headline` slot has
    `variants.en.length >= 3`
  - `playbooks.test.ts:103-104`: every non-neutral archetype has `copy_template.en.length > 50`
- Assertions: ~108 confirmed.
- Coverage delta (SDK playbooks module): RETRO-001 claimed "~40% → ~95%" — re-confirmed.
- CI checks: passed at merge — re-confirmed via QUEUE.md recent-merges.
- **NOT verified by tests (RETRO-001 missed these — added here):**
  - `variants.en[]` is never read by any production code path. The single integration test in
    `playbooks.test.ts:178 simulateDecisionTree()` maps `playbook.slots.map(s => s.en)` — index 0
    only — and the production routes (`apps/control-plane/src/app/api/adapt/route.ts:104` and
    `apps/decision-api/src/app/api/adapt/route.ts`) do the same. There is no test that asserts a
    `variants.en[i]` value is ever returned in an `AdaptResponse.directives[].value`.
  - `copy_template.en` is never read outside the test that asserts its existence. No production
    route consumes it.
  - Placeholder substitution against E.6's 7-level hierarchy is not tested anywhere — the SDK still
    has only the DOM-attribute branch.

### 3. Discovered gaps

#### 3a. Logic gaps

- **Rule H instance #3 at the SDK contract layer — `variant_index` not on `TextDirective`.**
  RETRO-001 FOLLOW-001 focused on bandit DB seeding and "Decision API always returns
  variant_index=0". But RETRO-001 did NOT flag that `packages/shared/src/directives.ts:46`
  (`TextDirective`) has NO `variant_index` field at all. Even if FOLLOW-007 lands and the bandit is
  wired, the shared type cannot transport the index from Decision API to SDK without a new field —
  which is a breaking shared-type change requiring Rule G handling (mock scan). This is a
  pre-existing gap that compounds Rule H: not only is the runtime not wired, the on-wire contract
  cannot transport the selected index. → FOLLOW-025 (P1, architect + backend-engineer, 1h —
  pre-design the field as `variant_index?: 0 | 1 | 2` on `TextDirective` with a default of `0`, ship
  in same PR that wires FOLLOW-007, do Rule G scan).
- **Rule H instance #4 at the placeholder layer — E.6 7-level hierarchy is doc-only.** Master Design
  v1.6 E.6 (added in this same PR via doc changes) describes a 7-level placeholder resolution order
  (LLM-provided value → tenant override → `ListingContext` → DOM attribute → fallback → …). The
  shipped code at `packages/sdk/src/core/adapt.ts:87-100` checks ONLY the DOM-attribute path
  (`data-estalara-<token>`). Tokens like `{yield}`, `{income}`, `{key_feature}`,
  `{key_luxury_feature}`, `{school_rating}`, `{distance_to_university}`, `{university}` appear in
  20+ slot strings and copy*template strings; if a host page does not happen to attach all of those
  as data attributes, the SDK emits `adapt.skipped {reason:
  unresolved_token*<name>}`and leaves the literal`{token}`visible on the page. RETRO-001 did NOT mention this. Severity: P1 — visible user-facing brokenness on any host page that doesn't fully wire data attributes. The new`{key_luxury_feature}`token (luxury-buyer) and`{distance_to_university}`token (student-parent) are particularly unlikely to appear as DOM attributes on real estate sites. → FOLLOW-026 (P1, sdk-engineer + ml-engineer, 4h — implement at least levels 1–3 of E.6: LLM-provided value (read from`listingContext`if request includes it), tenant override map (from`tenants.placeholder_overrides`),
  DOM attribute (current behavior). Levels 4–7 deferred to Sprint 10.)
- **Rule H instance #5 at the LLM gateway layer — `copy_template` is NOT used as a seed in Sonnet
  prompt.** Master Design v1.6 E.7 explicitly says "copy_template.en is the seed text for Sonnet
  generation (Tier 2 / Tier 3)". The current `buildSonnetPrompt()` at
  `apps/control-plane/src/lib/llm-gateway.ts:215-239` references `basePlaybook.description`,
  `basePlaybook.signals`, and `sessionContext` — but NEVER includes `basePlaybook.copy_template.en`
  in the prompt. The Haiku prompt similarly ignores `copy_template`. So even once
  `GET /api/adapt/description` (FOLLOW-002) is built, the existing `/api/adapt` Sonnet path will
  generate descriptions from scratch rather than refining the curated 100–150-word template.
  RETRO-001 §3a flagged the missing endpoint but did NOT flag that the EXISTING gateway also fails
  to use the seed. → FOLLOW-027 (P1, ml-engineer, 1.5h — add
  `Seed description:\n${basePlaybook.copy_template.en}\nRefine this for the buyer based on the signals above`
  block to `buildSonnetPrompt()`, gate behind `tier !== 1` so Tier 1 paths don't waste tokens).
- **Variant selection has zero per-session stickiness even at the SDK layer.**
  `applyTextDirective()` at `packages/sdk/src/core/adapt.ts:103-136` fingerprints on
  `text:${slotName}:${archetypeId}` — it has no slot for variant_index. Once FOLLOW-007 lands and
  the server returns different `variant_index` values, the SDK's idempotency check would
  (incorrectly) skip a second directive that differs only in variant. Combined with the
  `resetAdaptState()` in `refreshDirectives()` (RETRO-003 FOLLOW-020), this means the SDK has TWO
  independent paths to render-flicker variants. → FOLLOW-028 (P2, sdk-engineer, 1h — once
  variant_index lands on TextDirective, widen the fingerprint to
  `text:${slot}:${archetype}:${variant_index ?? 0}` AND cache the picked variant_index in
  `sessionStorage` keyed on session_id so refreshes return the same index).
- **`feature-section` rename has no contract test.** RETRO-001 FOLLOW-003 / TICKET-SLOT-CONTRACT-001
  was promoted to address this. Confirmed: ticket spec exists at
  `backlog/sprint-8/TICKET-SLOT-CONTRACT-001.md`. Status: still READY (not DONE). Until the contract
  test is merged, the same bug class can recur — particularly if a new Tier-3 slot (e.g. `body`,
  `subhead`) is added without simultaneously updating the Sonnet prompt's "Available slots" line.
  Not a new gap — but worth marking that **the Rule H pattern's process safeguard (FOLLOW-024) and
  the Rule F safeguard (FOLLOW-003 / TICKET-SLOT-CONTRACT-001) are BOTH still open** as of this
  retro.

#### 3b. Code bugs

- **`MOCK_PLAYBOOK` in `apps/control-plane/src/lib/__tests__/llm-gateway.test.ts:48` does not carry
  `variants`.** The mock's `slots: [{ slot: 'headline', en: '...' }]` is a valid `PlaybookEntry`
  (since `variants` is optional) — but it does not exercise the gateway's behavior with `variants`
  present. When FOLLOW-027 lands and Sonnet starts seeing the variants array via the prompt, this
  mock will no longer cover the realistic path. Severity P3 (latent; bites at FOLLOW-027 merge
  time). Flag for visibility — fold into FOLLOW-027 AC.
- **`neutral.ts` has `copy_template: { en: '' }` — empty string passes type check but violates the
  lint intent of FOLLOW-004.** The promoted ticket TICKET-LINT-ARCHETYPE-001
  (`backlog/sprint-8/TICKET-LINT-ARCHETYPE-001.md`) lints "non-neutral archetypes must have
  copy_template.en.length > 50" — confirmed by `playbooks.test.ts:104`. So neutral is correctly
  excluded. However, the empty string in neutral means if a future code path uses
  `getPlaybook('neutral').copy_template.en` as fallback for tenants without an archetype-mapped
  template, that fallback renders an empty description. RETRO-001 did not flag this. Severity P3
  (latent; depends on Sprint 9 DESC-001 behavior).
- **The `feature-section` → `feature` rename touched two places (`yield-hunter.ts` slot,
  `llm-gateway.ts` Sonnet prompt) — but RETRO-001's verification grep
  (`grep -rn "feature-section" packages/sdk/src/core/playbooks/ apps/control-plane/src/`) was NOT
  run repo-wide.** Re-running the grep on the WHOLE repo
  (`grep -rn "feature-section" /home/user/Adaptive-Listings/packages/ /home/user/Adaptive-Listings/apps/ --include="*.ts" --include="*.tsx" --include="*.md" 2>/dev/null`)
  returns 0 matches in code but presumably non-zero in older RETROSPECTIVES.md / ESCALATIONS.md /
  docs/adr/ references (informational). Verified clean in code paths. No bug.

#### 3c. Test coverage gaps

- **No test asserts that `variants.en[i]` for `i in {0,1,2}` produces a valid TextDirective shape.**
  `playbooks.test.ts:97-98` asserts the array has length ≥ 3 — but does NOT assert each element is a
  non-empty string, contains balanced `{token}` braces, or differs from siblings. A future PR could
  ship `variants: { en: ['Headline A', '', 'Headline A'] }` and the test would pass. → FOLLOW-029
  (P2, qa-engineer, 1h — extend the assertion to
  `each(v => v.length > 5 && /^\S/.test(v) && !duplicates(variants.en))`).
- **No test asserts the placeholder substitution path for `copy_template`.** Every non-neutral
  archetype's `copy_template.en` contains 1–3 `{token}` placeholders (e.g. `{yield}`, `{bedrooms}`,
  `{key_feature}`, `{key_luxury_feature}`, `{school_rating}`, `{distance_to_university}`,
  `{university}`, `{income}`). When DESC-001 lands and renders these templates, the unresolved-token
  failure mode (current `interpolatePlaceholders` behavior) will silently leave `{tokens}` visible.
  No test today catches this. → FOLLOW-030 (P2, qa-engineer, 1.5h — extract all `{token}` names from
  every archetype's `copy_template.en` and `slots[].en` + `slots[].variants.en[]`, build a
  REQUIRED_TOKENS set, and assert every token appears in a documented placeholder-source table once
  E.6 implementation lands). Blocks meaningful FOLLOW-026 + FOLLOW-002 sign-off.
- **No regression test for the locale-fallback path.** `SlotDirective` has `pl?` / `es?` overrides
  and `variants.{pl?, es?}` — no archetype currently fills them, but there is no test asserting "if
  `pl` is absent, fall back to `en`". The Decision API at
  `apps/control-plane/src/app/api/adapt/route.ts:107` reads `s.en` directly, never consulting `pl`
  or `es`. So if a tenant configures `locale: 'pl'`, they silently get English. Severity P2 —
  RETRO-001 missed entirely. → FOLLOW-031 (P2, backend-engineer + sdk-engineer, 2h, Sprint 10 —
  thread `locale` through `AdaptRequest` body, fall back EN → PL → ES per E.6 §2 vocabulary).
- **No test asserts that the `MOCK_PLAYBOOK` in llm-gateway.test.ts is structurally compatible with
  every real archetype shipped in this PR.** A trivial guard would be:
  `import yieldHunterPlaybook; expect(MOCK_PLAYBOOK satisfies PlaybookEntry; yieldHunterPlaybook satisfies PlaybookEntry)`.
  The current setup means a future required-field addition to `PlaybookEntry` only breaks the test
  if the author remembers to update the mock. Severity P3. Flag — not creating a follow-up; Rule G
  already enforces the scan obligation.

#### 3d. Documentation gaps

- **Master Design v1.6 E.6 (placeholder resolution) and E.7 (description pipeline) are doc-only —
  RETRO-001 did not call out the doc/code divergence.** RETRO-001 §3d said "Master Design updated to
  v1.6 in PR #93" but did not check that the E.6/E.7 sections describe behavior that has no
  implementation. The shipped v1.6 doc body now claims "placeholder tokens are resolved using a
  7-level hierarchy" — a reader of the doc would assume this works. Severity P2 — misleading for any
  agent picking up DESC-001 or any onboarding engineer. → FOLLOW-032 (P2, architect, 0.5h — add an
  "Implementation status: scaffold/doc only — see FOLLOW-002, FOLLOW-026, FOLLOW-027 for runtime
  wiring" note inline to E.6 and E.7).
- **`packages/sdk/src/core/playbooks/types.ts:29` comment says "Minimum 3 variants required on
  headline slots for non-neutral archetypes."** This is enforced ONLY by the test at
  `playbooks.test.ts:97-98` — there is no TypeScript-level or Zod-level enforcement. A new archetype
  author who skips the test invariant could silently ship 1 variant and pass type-check. RETRO-001
  missed this. Severity P3 — same shape as FOLLOW-004 / TICKET-LINT-ARCHETYPE-001, which is now
  promoted. Verify FOLLOW-004 spec actually checks variants count, not just `copy_template.en` —
  reading `backlog/sprint-8/TICKET-LINT-ARCHETYPE-001.md` confirms it only lints
  `copy_template.en length > 50`. So the variants-count invariant has no lint at all. → FOLLOW-033
  (P3, sdk-engineer, 0.5h — extend TICKET-LINT-ARCHETYPE-001's assertion set OR add a sibling
  assertion that headline slots have `variants.en.length >= 3`).

### 4. Cascading impact

#### 4a. Current sprint tickets affected

- **TICKET-SLOT-CONTRACT-001 (Sprint 8, READY, from FOLLOW-003):** Still open. Until it merges, the
  Rule F invariant is enforced only by manual review. RETRO-004 confirms the spec is correct as
  written but flags that the test should ALSO assert no slot name in any archetype contains a hyphen
  or underscore (more general guard than just `feature-section`).
- **TICKET-LINT-ARCHETYPE-001 (Sprint 8, READY, from FOLLOW-004):** Should be extended with the
  variants-count invariant per FOLLOW-033, OR FOLLOW-033 should ship as a separate ticket. PM
  decides at sprint planning.
- **TICKET-ARCH-MD-001 (Sprint 8, READY, from FOLLOW-005):** Bumps Master Design to v1.7 with
  B.8/B.9 patches. Coordinate with FOLLOW-032 (E.6/E.7 status notes) — both touch MASTER_DESIGN.md;
  combine into one architect pass if possible. Add as a note to TICKET-ARCH-MD-001 spec.
- **TICKET-RETRO-001 (Sprint 8, DONE):** The learning loop infrastructure that this very RETRO-004
  exercises. Confirmed working — RETRO-004 found 5 NEW gaps that RETRO-001 missed, validating the
  premise that deeper re-analysis with cross-retro context produces stronger findings.

#### 4b. Future sprint tickets affected

- **TICKET-DESC-001 (Sprint 9, BACKLOG, P1):** Three NEW dependencies surfaced by RETRO-004:
  1. **FOLLOW-026 (E.6 placeholder resolution)** — DESC-001 cannot meaningfully render
     `copy_template.en` until placeholder substitution covers at least levels 1–3. Without it, the
     Tier 1 path returns descriptions with literal `{yield}` / `{bedrooms}` etc. visible to users.
  2. **FOLLOW-027 (`copy_template` as Sonnet seed)** — DESC-001 spec at
     `backlog/sprint-9/TICKET-DESC-001.md` says "Sonnet 4.6 generates description from
     copy_template.en seed" — but the current Sonnet prompt does not use `copy_template` at all.
     DESC-001 must either build a NEW dedicated description-generation prompt OR FOLLOW-027 must
     land first so the canonical seed pattern exists.
  3. **FOLLOW-030 (token coverage test)** — without it, DESC-001 ships with no contract for what
     placeholder tokens the pipeline must support.
- **TICKET-BANDIT-VARIANTS (post-Sprint 10, from FOLLOW-001, to be folded into FOLLOW-007):**
  FOLLOW-025 (TextDirective.variant_index field) must land in the SAME PR as the variant_index
  propagation work — separating them creates a typecheck cliff. Update FOLLOW-007 AC to include
  FOLLOW-025.
- **TICKET-VAL-001 (Sprint 9, BACKLOG, P1) — continuous schema validation cron:** No direct impact
  on playbook changes. Clean.
- **TICKET-NATIVE-001 (BLOCKED):** The Native app at `app.estalara.com` would render
  `copy_template.en` text directly. Same placeholder gap (FOLLOW-026) blocks it. Update
  TICKET-NATIVE-001's `depends_on` to include FOLLOW-026 alongside FOLLOW-018.
- **TICKET-CAUSAL-001 (Sprint 8 BACKLOG, P2):** CATE analysis on variants is impossible until
  FOLLOW-007 + FOLLOW-025 ship — already noted in RETRO-002 §4b. RETRO-004 confirms.
- **Future i18n tickets (no current spec):** FOLLOW-031 (locale fallback for `pl`/`es`) is a
  prerequisite. Without it, every non-English-locale rollout will silently serve English copy.

#### 4c. Contracts changed

- **`PlaybookEntry.copy_template` required field** — re-confirmed Rule G hit. Inline-mock scan
  (`grep -rn "PlaybookEntry" packages/ apps/ --include="*.ts"`) shows the field is satisfied
  everywhere it's constructed: `MOCK_PLAYBOOK` in llm-gateway test plus 18 archetype files (17
  non-neutral + neutral). No other inline-mock sites exist. **Confirmed clean** — RETRO-001 was
  correct on this axis.
- **`SlotDirective.variants` optional field** — additive; no downstream breakage. Consumed by ZERO
  non-test files in `packages/` or `apps/` (re-confirmed with grep). The field exists purely as data
  awaiting FOLLOW-007 to wire it. **Rule H instance reaffirmed** — RETRO-001 §3a marked this as
  "bandit variant selection not wired" but did not connect it to Rule H because Rule H was promoted
  in RETRO-002 AFTER RETRO-001 was written. This retro retroactively logs PR #92 as the FIRST Rule H
  occurrence in the codebase (the variant_index gap), with AB-001 / REORDER-001 as instances #2 and
  #3.
- **Master Design v1.6 E.6/E.7 doc-only contract** — NEW cross-cutting concern: the Master Design
  document now describes behavior that NO code implements. This is a new type of contract
  divergence: doc-as-spec divergence. Different from Rule H (which is symbol-as-spec divergence) —
  but the same root cause: ship the description ahead of the implementation. See Section 5 for
  candidate Rule promotion.

#### 4d. Architectural assumptions affected

- **Master Design v1.6 E.3 + E.6 + E.7 assume a placeholder-resolution pipeline + variant-selection
  pipeline + description pipeline all coexist.** Shipped state: none of the three pipelines is
  wired. The architecture (4 layers: data → selection → resolution → render) is sound; only the data
  layer (variants + copy_template + E.6 doc) shipped. This is now the **largest single Rule H
  occurrence in the codebase** (5 instances inside one PR + 1 doc section): variants, copy_template,
  TextDirective.variant_index, E.6 hierarchy, E.7 endpoint, E.7 Modal job.
- **The fair-housing escalation (ESCALATIONS.md, 2026-05-13)** flagged earlier in RETRO-002 §4d /
  RETRO-003 §4d does NOT directly bind PR #92 — variants and copy_template are text-only and
  behavior-anchored. HOWEVER: the new `student-parent` archetype's `copy_template.en` contains
  `{university}` and `{distance_to_university}` placeholders + describes an HMO/rental-to-child
  model. The `family_buyer` headline variant
  `'Spacious {bedrooms}-Bedroom Home Near Top-Rated Schools'` and copy_template mention "growing
  families", "children", "primary school rated outstanding". These are familial-status
  protected-class references under the US Fair Housing Act (1968 + 1988 amendment). Under HUD
  ad-content guidance, descriptions and headlines that segment-and-show by familial status to a
  SUBSET of viewers (which is what archetype routing does) COULD be construed as steering. **This is
  a pre-existing concern** (the playbook archetypes themselves have always been segmented; this PR
  added new copy that strengthens the language) — but RETRO-001 did NOT raise it. RETRO-004 raises
  it here for visibility; compliance review recommended before any US-region pilot. → FOLLOW-034
  (P0, compliance-engineer, 3h — review the 17 shipped `copy_template.en` strings and 51 variant
  strings against HUD Fair Housing ad-content guidance for protected-class steering signals;
  document a decision matrix per archetype for which variants are US-region-eligible).
- **Tier model:** `copy_template` is described in the type comment as "(a) fallback for Tier 1 in
  GET /api/adapt/description (b) seed text for Sonnet generation (Tier 2 / Tier 3)". The TIER-1 vs
  TIER-2/3 split is now a hardcoded assumption in 17 playbook entries. Once FOLLOW-016 (RETRO-003)
  decides whether tier is billing-label vs directive-filter, that decision must be reflected in
  whether Tier 1 tenants are even served `copy_template` directly OR fall back to the listing's
  original description. Coordinate with FOLLOW-016. Not blocking — fold into the tier-semantics ADR
  proposed by FOLLOW-016.

### 5. New lesson candidates

- **Pattern: "Schema/scaffold complete, runtime wiring deferred — no test asserts the wiring exists"
  (Rule H).** RETRO-001 + RETRO-002 + RETRO-003 = 3 retros, ≥7 instances. RETRO-004 adds FIVE MORE
  instances inside the same PR (variants array, copy_template field, TextDirective lacking
  variant_index, E.6 hierarchy doc-only, E.7 pipeline doc-only). **Rule H stands; further
  strengthening already proposed via FOLLOW-024 (RETRO-003).** RETRO-004 adds a refinement: Rule H
  should treat **doc-only Master Design sections that describe runtime behavior** as ALSO
  triggering. Recommend amending Rule H §1 from "non-test file imports the new symbol" to ALSO cover
  "new MASTER_DESIGN.md section describing runtime behavior must reference a TICKET-NNN or
  FOLLOW-NNN with `recommended_sprint: <number>` in the same PR." This is a Rule H amendment, NOT a
  new rule.
- **Pattern: "Master Design section describes runtime behavior with NO code implementing it"** —
  seen specifically in PR #92's v1.6 E.6 + E.7. Count: 1 retro, 2 doc instances. **Threshold: 2 NOT
  YET met as a separate pattern.** However, this is genuinely a SUB-CASE of Rule H §3 ("dated
  deferral + FOLLOW-NNN stub"). PR #92 added E.6 and E.7 to the Master Design but did NOT add
  FOLLOW-NNN stubs for them in the same commit (RETRO-001 retroactively added FOLLOW-002 for E.7;
  E.6 has NO follow-up to this day — RETRO-004 creates FOLLOW-026). Recommend AMENDING Rule H to
  explicitly cover Master Design sections rather than promoting a new rule. Promotion deferred.
- **Pattern: "Mock object in tests carries fewer fields than real instances of the type"** — seen in
  RETRO-004 only (`MOCK_PLAYBOOK` lacks `variants`). Count: 1 retro. **Threshold: 2 NOT YET met.**
  Track. Note: this overlaps Rule G but in the opposite direction (Rule G is about REQUIRED fields
  being missed; this is about OPTIONAL fields being absent from mocks even though every real
  instance includes them, making the mock non-representative).
- **Pattern: "Required token in playbook string has no documented data source"** — seen in RETRO-004
  only (e.g. `{key_luxury_feature}` in luxury-buyer; `{distance_to_university}` in student-parent).
  Count: 1 retro. **Threshold: 2 NOT YET met.** Track. If a future ticket adds new placeholder
  tokens without a registry of resolvers, promote to Rule I "Every placeholder token must be
  registered in a central resolver table."

**No new rule promoted in this retro.** Rule H continues to absorb the dominant pattern. The "Master
Design doc-only spec" sub-pattern is recommended for Rule H amendment, not as a separate Rule, per
the threshold logic. Rules A–H remain canonical.

### 6. Follow-ups

- FOLLOW-025: Add `variant_index?: 0 | 1 | 2` to `TextDirective` in
  `packages/shared/src/directives.ts` ahead of FOLLOW-007 wiring; perform Rule G mock-scan; document
  field semantics in JSDoc (architect + backend-engineer, 1h, P1, Sprint 9)
- FOLLOW-026: Implement E.6 placeholder resolution levels 1–3 in
  `packages/sdk/src/core/adapt.ts:interpolatePlaceholders()` — LLM-provided value, tenant override
  map, DOM attribute fallback (sdk-engineer + ml-engineer, 4h, P1, Sprint 9 — unblocks DESC-001 and
  NATIVE-001)
- FOLLOW-027: Add `copy_template.en` as seed text to `buildSonnetPrompt()` in
  `apps/control-plane/src/lib/llm-gateway.ts`; gate behind `tier !== 1` (ml-engineer, 1.5h, P1,
  Sprint 9 — required by DESC-001)
- FOLLOW-028: Widen SDK applyTextDirective fingerprint to include `variant_index` AND cache
  variant_index in sessionStorage keyed on session_id (sdk-engineer, 1h, P2, Sprint 9 — lands with
  FOLLOW-007)
- FOLLOW-029: Strengthen `playbooks.test.ts:97-98` variants assertion — each variant non-empty,
  non-duplicate, balanced braces (qa-engineer, 1h, P2, Sprint 8)
- FOLLOW-030: Token-coverage contract test — extract every `{token}` from playbook slots +
  copy_templates, assert each appears in a documented resolver table (qa-engineer, 1.5h, P2, Sprint
  9 — gates FOLLOW-026 + DESC-001 sign-off)
- FOLLOW-031: Thread `locale` through `AdaptRequest` body + add EN→PL→ES fallback in playbook slot
  selection (backend-engineer + sdk-engineer, 2h, P2, Sprint 10)
- FOLLOW-032: Add "Implementation status: scaffold only — see FOLLOW-NNN" notes to MASTER_DESIGN.md
  E.6 and E.7 (architect, 0.5h, P2, Sprint 8 — combine with TICKET-ARCH-MD-001 if scheduled
  together)
- FOLLOW-033: Extend TICKET-LINT-ARCHETYPE-001 (or add sibling test) to assert every non-neutral
  archetype's headline slot has `variants.en.length >= 3` (sdk-engineer, 0.5h, P3, Sprint 8 — fold
  into LINT-ARCHETYPE-001 if not yet merged)
- FOLLOW-034: Compliance review — audit 17 `copy_template.en` strings + 51 variant strings against
  HUD Fair Housing ad-content guidance for protected-class steering (familial status, schools,
  catchment, student/parent framing); document per-archetype US-region eligibility matrix
  (compliance-engineer, 3h, P0, Sprint 8 — BLOCKS US-region pilot)

### 7. Cross-references

- **RETRO-001 (TICKET-046, original retro of this PR):** RETRO-004 is the deep re-analysis pass.
  RETRO-001 §3a captured the variant_index wiring gap (FOLLOW-001) and the copy_template pipeline
  gap (FOLLOW-002) but UNDER-COUNTED the Rule H surface — RETRO-004 finds 5 more instances inside
  the same PR (FOLLOW-025, FOLLOW-026, FOLLOW-027, plus the two doc-only Master Design sections
  E.6/E.7). RETRO-001 also did not flag the LLM gateway's failure to USE `copy_template` as a seed
  (FOLLOW-027) — that gap was masked by the assumption that "endpoint missing = pipeline missing,"
  whereas the EXISTING gateway also fails to use the field. RETRO-001 also did not flag the locale
  fallback hole (FOLLOW-031) or the placeholder coverage gap (FOLLOW-030). RETRO-001 also did not
  raise the fair-housing risk for the new family/student-parent variant copy (FOLLOW-034). Net:
  RETRO-004 adds 10 follow-ups on top of RETRO-001's original 5. The learning loop is correctly
  surfacing depth that the first pass missed.
- **RETRO-002 (TICKET-AB-001):** Rule H was promoted here. RETRO-004's findings strengthen Rule H
  with 5 more instances. FOLLOW-025 (variant_index on TextDirective) is a PREREQUISITE for RETRO-002
  FOLLOW-007 (Thompson sampling wiring) — combine in same PR. RETRO-002 FOLLOW-006 (ab.assignment
  event emission) is unrelated to PR #92's content but shares the same shape.
- **RETRO-003 (TICKET-REORDER-001):** Rule H instance #3 (REORDER-001's `listing_ids` field on
  decision-api) is structurally identical to PR #92's variants field — both shipped declared but
  unwired. RETRO-003 FOLLOW-024 (Rule H hard pre-merge gate) would have caught PR #92's gaps if it
  had existed at merge time. **Strong argument for prioritizing FOLLOW-024 in Sprint 8.** RETRO-003
  FOLLOW-016 (tier-as-billing-label vs tier-as-directive-filter) needs to be resolved before
  FOLLOW-002 / DESC-001 can decide whether Tier 1 tenants are served `copy_template.en` directly or
  whether the listing's original description is preferred — fold into FOLLOW-016 spec.
- **CONVENTIONS_PATCH.md Rule F (slot names):** Re-confirmed by this PR. `feature-section` →
  `feature` rename was caught and fixed; no new violations introduced.
- **CONVENTIONS_PATCH.md Rule G (breaking type changes):** Re-confirmed by this PR. `copy_template`
  required field was correctly propagated to the only inline mock (`MOCK_PLAYBOOK` in
  llm-gateway.test.ts). No regression.
- **CONVENTIONS_PATCH.md Rule H (schema scaffold + deferred wiring):** **PR #92 is retroactively
  logged as the chronologically FIRST Rule H occurrence** (variants + copy_template wired only at
  the data layer). Rule H promoted in RETRO-002 with PR #80 as evidence; RETRO-004 establishes that
  PR #92 (merged the same day as #80) actually contained the same pattern but RETRO-001 framed it as
  a discrete "wiring gap" rather than a recurring class. Rule H now has documented evidence in 4
  retros (RETRO-001, RETRO-002, RETRO-003, RETRO-004) and ≥12 distinct instances. The pattern's
  recurrence at this density confirms that FOLLOW-024 (hard pre-merge gate) is correctly P1 and
  should land in Sprint 8 not later.
- **ESCALATIONS.md (Fair-housing resolution, 2026-05-13):** RETRO-002 and RETRO-003 both noted the
  caveat binds REORDER-001 scoring (FOLLOW-019). RETRO-004 surfaces a NEW fair-housing concern at
  the COPY layer — the new family/student-parent variants and copy_templates explicitly invoke
  familial status as a value proposition. This is upstream of REORDER-001 (which only ranks
  listings, not text) and was not previously flagged. → FOLLOW-034 (P0, blocks US-region pilot).

---

## RETRO-005 — Sprint 9.5 (MVP Demo Readiness — Auto-Onboarding M1 + Bandit + Scoring) — 2026-05-22

**Scope:** Sprint-level retrospective bundling 6 merged PRs (#121, #122, #123, #124, #125, #126).
Sprint 9.5 was the "MVP demo readiness" sprint — the explicit goal in the QUEUE preamble was to make
the zero-config onboarding promise demoable end-to-end on `app.estalara.com`, then on any new tenant
via Magic Link, AND to wire bandit variant selection + real archetype-listing affinity so the demo
narrative includes "honest live optimization." This retro evaluates whether the shipped surface
delivers on that promise. Spoiler: the wire is closer than at the start of the sprint, but at least
three of the six PRs ship as **producer-only half-wires** that the demo script will silently degrade
through without surfacing the failure to the operator.

### 1. Summary of change

| PR   | Ticket                 | Title                                                                 | Files | +/−         | Merged                       |
| ---- | ---------------------- | --------------------------------------------------------------------- | ----- | ----------- | ---------------------------- |
| #121 | TICKET-033             | Schema Discovery API — JWT + SSRF + wizard response                   | 6     | +885 / −102 | 2026-05-21 19:57Z, `a413f27` |
| #122 | FOLLOW-007             | Wire Thompson sampling bandit into adapt path                         | 15    | +1374 / −3  | 2026-05-21 19:56Z, `306cc6e` |
| #123 | FOLLOW-019             | Real archetype-listing affinity — cosine similarity replaces djb2     | 15    | +1305 / −24 | 2026-05-21 19:48Z, `0b01cfe` |
| #124 | TICKET-030             | Magic Link onboarding wizard UI                                       | 5     | +705 / −2   | 2026-05-21 20:31Z, `141d31a` |
| #125 | TICKET-AUTO-006-POLISH | Detection Preview + Save & Activate (schema activation + SDK snippet) | 7     | +1143 / −19 | 2026-05-22 08:17Z, `ca244a6` |
| #126 | FOLLOW-018             | Real tenant schema lookup — cache invalidation on activation          | 5     | +218 / −2   | 2026-05-22 09:46Z, `acb8bb7` |

**Cumulative:** 53 files changed, +5,630 / −152 across the sprint. Three new top-level routes
(`POST /api/detect` hardened, `POST /api/schema/activate` new, `POST /api/adapt/feedback` new,
`POST /api/listings/embed` new), one new dashboard page (`/dashboard/onboarding/detect`), two new
pgvector tables (`listing_embeddings` migration 0013; archetype_embeddings was already present), one
ClickHouse column (`adaptation_decisions.variant`), and one new Zod schema (`DetectResponseSchema`
in `@estalara/shared`).

**Per-PR one-sentence summaries:**

- **PR #121 (TICKET-033):** Wraps the existing Sprint 7.5 detection engine in a JWT-authenticated,
  SSRF-protected, 60-second-cached HTTP API with a flattened "wizard-ready" response and persists
  results to `tenant_site_schemas` (`apps/control-plane/src/app/api/detect/route.ts:175-435`).
- **PR #122 (FOLLOW-007):** Adds the canonical `packages/shared/src/bandit.ts`, wires
  `getBanditArms()` + `thompsonSample()` into the **control-plane** POST adapt route
  (`apps/control-plane/src/app/api/adapt/route.ts:648-649`), and creates a new fire-and-forget
  `POST /api/adapt/feedback` endpoint that increments Beta(α, β) on conversion signals.
- **PR #123 (FOLLOW-019):** Introduces the `listing_embeddings` pgvector table + a Drizzle schema +
  the `POST /api/listings/embed` admin endpoint, and replaces the djb2 hash with cosine similarity
  in `buildReorderDirective()` (both `apps/control-plane/src/app/api/adapt/route.ts:280-360` and the
  duplicate in `apps/decision-api/src/lib/reorder.ts`) — djb2 retained as a per-listing fallback
  when embeddings are unavailable.
- **PR #124 (TICKET-030):** Adds `/dashboard/onboarding/detect` (Server Component) and the
  `<DetectWizard>` client component with the `idle → analyzing → detected | needs_review | failed`
  state machine, plus a stub `<DetectionPreview>`.
- **PR #125 (TICKET-AUTO-006-POLISH):** Replaces the `<DetectionPreview>` stub with the full
  field-table UI, adds `POST /api/schema/activate` that upserts the schema, promotes `tenant.status`
  from `pending → active`, and looks up or generates a public API key — the response feeds the SDK
  `<script>` snippet displayed to the operator.
- **PR #126 (FOLLOW-018 follow-up):** Adds `invalidateTenantSchemaCache()` and calls it from the
  activation path so the next adapt request after activation doesn't read stale Redis data.

### 2. Verification in PRs

- Test files added/changed: 12 (across the 6 PRs).
- New assertions: ~135 (38 for detect route, 42 for bandit/feedback, 33 for cosine/embed/affinity,
  11 for DetectWizard, 10 for DetectionPreview, 9 for activate, 7 for cache invalidation).
- Coverage delta: control-plane went from 367 → 481 tests (per PR #126 final count).
- CI checks: TypeScript/JS lanes green across all PRs. Pre-existing failures **not** caused by this
  sprint: Rule I baseline (92 dead symbols — actually decreased by 4 due to PR #122 wiring); Python
  test scaffolding gaps; Doppler verify (optional). PR #125 was merged with **all GitHub Actions
  billing-blocked** (escalation logged in `backlog/ESCALATIONS.md`); the human merged on the
  strength of 474 local tests + clean pre-commit hooks. PR #122 / #123 / #126 all ran on resumed
  billing.
- **NOT verified by tests** (load-bearing gaps — see section 3):
  - No SDK-level test asserts the `variant` field returned by `POST /api/adapt` is propagated back
    to `POST /api/adapt/feedback` on outcome events. The SDK ships zero code paths that call
    `/api/adapt/feedback`; the bandit feedback loop has a producer endpoint with no consumer.
  - No test asserts that `archetype_embeddings` has a non-null `embedding` for any of the 18
    archetypes. The seed migration `0005_seed_archetype_embeddings.sql` inserts 18 rows with
    `embedding = NULL`. `fetchArchetypeEmbedding()` returns null for all 18 archetypes in production
    today → cosine path is unreachable → djb2 fallback always wins. The integration test
    `route.variant.test.ts:107` mocks `getBanditArms()` directly so this gap is masked.
  - No integration test exercises `POST /api/detect` → `POST /api/schema/activate` →
    `POST /api/adapt` end-to-end against a real tenant_id. All three routes are tested with isolated
    mocks; the cross-route flow (which the demo depends on) is exercised only by manual QA.
  - PR #125 was merged with CI billing-blocked. The "all 474 local tests pass" claim was not
    independently re-verified by the PM under green CI before the merge button was pressed.

### 3. Wiring Audit

This sprint produces multiple HALF_WIRE_P (producer-only) findings that mirror the Rule H pattern
codified in RETRO-002 and re-confirmed in RETRO-003 and RETRO-004. Rule H now hits **5 retros in a
row** and continues to be the dominant failure mode.

- **HALF_WIRE_P** — `route:POST /api/adapt/feedback` — producer at
  `apps/control-plane/src/app/api/adapt/feedback/route.ts:111` (FOLLOW-007 / PR #122) — **no
  consumer** found anywhere in `packages/sdk/src/`. `grep -rn "adapt/feedback" packages/sdk/src/`
  returns 0 matches. The Beta(α,β) update math is wired, the auth gate works, the DB upsert works —
  but the SDK never POSTs to the endpoint when an outcome event (inquiry / CTA click) fires.
  Conversion signals from real traffic will never reach `ab_bandit_weights`, so Thompson sampling
  converges to its uniform Beta(1,1) prior forever. Priority **P0** for the demo narrative
  (FOLLOW-007 spec said "the SDK side of the feedback loop is out of scope for this ticket" — but
  without the consumer, the bandit story is mechanically untestable in the live demo) → FOLLOW-041.
- **HALF_WIRE_P** — `field:AdaptationDirectives.variant` — producer at
  `apps/control-plane/src/app/api/adapt/route.ts:701` (PR #122 sets `variant: selectedVariant`) —
  **no SDK consumer**. `packages/sdk/src/core/adapt.ts:33-50` (the `AdaptResponse` interface) does
  not include a `variant` field; `applyDirectives()` never reads it. The SDK cannot render different
  copy per variant and cannot echo the variant back on the feedback ping (which is the other end of
  FOLLOW-041). Combined with the FOLLOW-007 producer gap, the bandit pipeline is half-wired in both
  directions: **server picks a variant but tells no one; SDK has no slot to receive it**. Priority
  **P0** → FOLLOW-042.
- **HALF_WIRE_P** — `table:archetype_embeddings.embedding` — producer migration at
  `packages/db/migrations/0005_seed_archetype_embeddings.sql:5` seeds 18 rows with
  `embedding = NULL` — **no producer** populates the actual 1024-dim vectors. PR #123 adds
  `fetchArchetypeEmbedding()` as a consumer (`apps/control-plane/src/lib/embedding-lookup.ts:42`)
  and the function correctly returns `null` for any archetype with a null embedding, falling back to
  djb2 in `affinityScore()`. So FOLLOW-019's headline claim ("real archetype-listing affinity —
  cosine similarity replaces djb2 hash") is **functionally a no-op in production today**: every
  adapt request degrades to djb2 because the archetype side of the cosine math has no data. The seed
  comment at line 3 of the migration explicitly says "embedding is NULL — the 1024-dim vector is
  filled in by the Modal daily job" — but **no such Modal job exists**
  (`grep -rn "archetype_embedding" apps/*-pipeline/` returns 0 results outside placeholder files).
  Priority **P0** for the FOLLOW-019 demo narrative → FOLLOW-043.
- **HALF_WIRE_C** — `schema:DetectResponseSchema` (Zod) — consumer was advertised in PR #121's
  description ("added to `packages/shared/src/schemas/detect.ts` ... for consumption by TICKET-030")
  — **PR #124 declares its own duplicate `DetectApiResponse` interface** at
  `apps/control-plane/src/components/onboarding/DetectWizard.tsx:39-49` instead of importing
  `DetectResponse` from `@estalara/shared`. The shared Zod schema has 0 non-test importers and is
  dead. This isn't a runtime break — both shapes coincide today — but the next field added to either
  side will silently drift. Priority **P2** (contract-drift latent) → FOLLOW-044.
- **DEAD_CODE candidate** — `apps/decision-api/src/lib/bandit.ts` — RETRO-002 §3a noted this had
  zero non-test importers in the Worker route. PR #122 wired the canonical copy in
  `packages/shared/src/bandit.ts` into the **control-plane** adapt route per ADR-0004. The
  decision-api `apps/decision-api/src/lib/bandit.ts` is now KEPT as a "byte-identical copy" per PR
  #122 description, but it remains imported by **only** its own test file
  (`apps/decision-api/src/lib/__tests__/bandit.test.ts`). The decision-api adapt route
  (`apps/decision-api/src/app/api/adapt/route.ts`) was not updated to call `thompsonSample()`. Since
  ADR-0004 explicitly names the control-plane route as canonical, this is **DEAD_CODE by design** —
  but the rationale for keeping it is "future Worker rollback" with no documented rollback plan.
  Priority **P2** (documentation + decision needed) → FOLLOW-045.
- **HALF_WIRE_P** — `route:POST /api/listings/embed` — producer for `listing_embeddings.embedding`
  vectors at `apps/control-plane/src/app/api/listings/embed/route.ts:1-207` (PR #123). The consumer
  side (`fetchListingEmbeddings()`) exists and is called from the adapt POST route. But no
  automation invokes `POST /api/listings/embed` on tenant onboarding or listing creation. The PR
  description says "operator calls `POST /api/listings/embed` per listing (with
  `INTERNAL_API_SECRET` for headless scripts)" — i.e., manual ops only. For the demo this is
  acceptable; for any real tenant rollout the gap will materialize as "FOLLOW-019 looks live in unit
  tests but degrades to djb2 in prod because nobody runs the seed script." Priority **P1**
  (demo-safe via manual ops; pilot-unsafe) → FOLLOW-046.

### 4. Discovered gaps

#### 4a. Logic gaps

- **`'estalara_staff'` sentinel writes into a `uuid` column.** Both
  `apps/control-plane/src/app/api/detect/route.ts:214` and
  `apps/control-plane/src/app/api/schema/activate/route.ts:97` fall back to the literal string
  `'estalara_staff'` as `tenantId` when `claims.tenant_id` is null. `tenant_site_schemas.tenant_id`
  is typed `uuid` with an FK to `tenants.id` (`packages/db/src/schema/tenant_site_schemas.ts:25`).
  An Estalara staff caller hitting either endpoint will not get a clean 4xx; the route will throw a
  Postgres `invalid input syntax for type uuid` error → the catch block returns 500 `INTERNAL_ERROR`
  from activate or "DB failure must not block the response" silent-swallow from detect, leaving the
  operator with no UX signal that staff-mode is unsupported. Severity **P1**: not blocking the demo
  (staff doesn't use Magic Link) but the silent-swallow path on detect means the cache write fails
  for staff and the next call re-runs detection, burning AI Vision quota — and any error in
  `console.error` is invisible in the wizard. → FOLLOW-047.
- **`POST /api/schema/activate` trusts body `schema.domain` without cross-validation.** The route
  reads `schemaValue.domain` at `apps/control-plane/src/app/api/schema/activate/route.ts:132` and
  upserts directly on `(tenantId, domain)`. An authenticated admin could supply an `ActivateRequest`
  whose `schema.domain` differs from the domain that was just detected (different from the original
  URL the operator typed in the wizard). The wizard always feeds the activate route with the
  freshly-detected schema, so the bug is latent today — but the contract has no integrity guarantee
  linking activation to a specific detect call. Severity **P2**: any attacker who has a JWT cannot
  escalate, but a confused operator workflow could activate a schema for `unrelated.com` against
  tenant X if they paste-edit the schema JSON. → FOLLOW-048.
- **No idempotency / replay guard on `POST /api/schema/activate`.** Activating twice for the same
  `(tenant, domain)` is a no-op on the upsert (good) but a NEW api_keys row may be generated if the
  previous one was revoked between activations. The route does not check for in-flight duplicates or
  use a request_id; a double-click on "Save & Activate" while the network is slow could create two
  public API keys (both valid, both displayed `prefix...last4` after the first one becomes
  `existingKeys[0]`). Severity **P2** → FOLLOW-049.
- **Cache invalidation race window.** PR #126 (FOLLOW-018) invalidates the Redis cache **after** the
  DB write but **before** returning 200 to the client. If the SDK fires its first `POST /api/adapt`
  request the millisecond after the wizard receives the activation 200, and Redis replication /
  read-replica lag is non-zero, the adapt route's `getTenantSchema()` could still hit a populated
  cache key on a replica that hasn't received the DEL. Upstash is single-region today so the race is
  sub-millisecond, but **as soon as US/UK regions come online (Master Design A.3 roadmap), this
  becomes a real bug**. Severity **P3** today, **P1** at multi-region. → FOLLOW-050.
- **`POST /api/adapt/feedback` accepts presence-only Bearer in dev/test mode.** When `ADAPT_API_KEY`
  is unset (which is the case in every Doppler config the auditor checked except prd — and prd
  hasn't been verified), any non-empty token is accepted. The endpoint mutates `ab_bandit_weights`
  directly. An attacker hitting `/api/adapt/feedback` from any origin can flood `converted: false`
  for `(tenant, archetype, control)` to bias the bandit against the control arm — adversarial bandit
  poisoning. Severity **P1** for any pilot that exposes control-plane to the internet → FOLLOW-051.

#### 4b. Code bugs not caught

- **`tenantSchemaCache` invalidation has a typo-prone REST API surface.**
  `apps/control-plane/src/lib/tenant-schema.ts:103-107` issues `GET /del/<key>` against Upstash.
  Upstash REST accepts both `GET /del/<key>` and `POST /del/<key>` for the DEL command (the GET-form
  is documented for simple commands). This works. However, the `redisSet` helper at line 75 uses
  `POST /set/<key>` with the value in the body. The mismatch (GET for DEL, POST for SET) is
  internally consistent but undocumented in the file — a future contributor adding a
  `redisGetAndDel` helper will need to know the verb convention. Severity **P3** → no FOLLOW-UP;
  flag for inline doc fix at next touch.
- **`affinityScore()` and `buildReorderDirective()` duplicate logic across two files.** Per ADR the
  decision-api Worker cannot import workspace packages at runtime, so PR #123 mirrors the cosine
  math + per-listing fallback in **both** `apps/decision-api/src/lib/reorder.ts` and
  `apps/control-plane/src/app/api/adapt/route.ts:280-360`. PR #122 does the same for bandit
  (`apps/decision-api/src/lib/bandit.ts` byte-identical to `packages/shared/src/bandit.ts`). The PR
  descriptions acknowledge the duplication and call out "byte-identical" / "sync requirement" but
  **no test or CI gate enforces the byte-identity**. Severity **P1** the next time someone patches
  one and forgets the other — RETRO-003 §3a already flagged this in REORDER-001 context and the
  pattern has now repeated twice in one sprint. → FOLLOW-052.
- **`POST /api/detect` cache guard uses denormalized `detectionConfidence` from the cached row but
  the wizard response uses `result.confidence` for fresh runs.** Lines 287-288 vs lines 428-429 of
  `apps/control-plane/src/app/api/detect/route.ts`: cached responses fill `detection_confidence`
  from `cachedRow.detectionConfidence` (denormalized stored value), fresh responses use
  `result.confidence` (returned by the detection engine). If a tenant runs detect, the engine
  returns `confidence=0.87`, the DB is written with `0.87`, then 30s later the cache hit returns
  `0.87` — this is fine. But the schema _inside_ the cached row was written with
  `detection_confidence` denormalized from `schema.detection_confidence`, which is set BEFORE the AI
  Vision fallback potentially overwrites `result.confidence`. In the AI Vision fallback path (lines
  335-354), `result` is reassigned but `result.schema.detection_confidence` is the pre-fallback
  value while `result.confidence` is the post-fallback value. The cache stores the pre-fallback
  `detection_confidence` AND the post-fallback `detectionConfidence` denorm column. Subsequent cache
  hits return inconsistent header values. Severity **P3** (only visible to operators reading raw
  responses; not user-facing) → FOLLOW-053.
- **`activateError` state in DetectionPreview never clears on retry.** `DetectionPreview.tsx` shows
  the error in a `role="alert"` block when `activateError !== null` (lines 244-251), but the only
  way to clear it is to land in the activated state. If the operator clicks "Save & Activate" → 500
  → "Save & Activate" again → 200, the prior error message hangs around in the DOM between the
  second click and the response. Severity **P3** UX nit → fold into FOLLOW-054.
- **`buildSnippet()` hardcodes `https://cdn.estalara.com/sdk.js`** at
  `apps/control-plane/src/components/onboarding/DetectionPreview.tsx:97` — but
  `packages/shared/src/domains.ts:16` exports `SDK_CDN_DOMAIN` and `SDK_CDN_URL` constants
  specifically to avoid hardcoding. Per CLAUDE.md "Quality bars" + the shared package's purpose,
  this should use the constant. Master Design §V.5.2 also references a versioned path
  (`/sdk/v1.2.3/estalara.min.js`) while the snippet ships `/sdk.js` (unversioned). Severity **P2** —
  if the CDN structure changes, every tenant snippet generated by Sprint 9.5's activation flow will
  silently 404. → FOLLOW-054.

#### 4c. Test coverage gaps

- **Zero integration test covers the demo flow end-to-end** (detect → activate → snippet → SDK loads
  → `POST /api/adapt` returns `variant` → SDK applies). Each of the six PRs unit-tests its slice in
  isolation with heavy mocking. The sprint's whole-product promise is "investor demo works
  end-to-end" but no test verifies the assembly. Severity **P0** for the actual investor demo
  confidence → FOLLOW-055.
- **No corpus regression test exercises the AI Vision fallback path with the new SSRF guard.** PR
  #121's SSRF guard runs BEFORE the cache guard and BEFORE the detection pipeline. The Sprint 7.5
  100/100 corpus runs against `packages/sdk/src/auto-detect/__fixtures__/*.html` files locally — not
  against URLs. So the corpus CI gate doesn't exercise SSRF blocking and doesn't exercise the
  route-level cache guard. Any regression in either is invisible to the green corpus signal.
  Severity **P2** → FOLLOW-056.
- **No test asserts `tenant.status` transitions only `pending → active`, never
  `suspended → active`.** The activate route at
  `apps/control-plane/src/app/api/schema/activate/route.ts:170-173` uses
  `.where(and(eq(tenants.id, tenantId), eq(tenants.status, 'pending')))` — correct guard — but the
  test at `route.test.ts:296` only asserts `set` was called with `status: 'active'`, not the WHERE
  clause. If a future refactor drops the `pending` filter, a suspended tenant could be silently
  re-activated. Severity **P2** → FOLLOW-057.
- **No load test for `POST /api/detect` 60-second cache.** The cache guard is intended to prevent
  burst-clicking the wizard's "Detect" button from blowing AI Vision daily quota. There is no test
  that the cache actually prevents N concurrent identical requests from issuing N AI Vision calls.
  The Drizzle select returns a single row when one exists, but the race window between request N and
  request N+1 (both miss the cache, both run detection, both write, second overwrites first) is real
  and unmeasured. Severity **P2** → FOLLOW-058.
- **PR #126 (FOLLOW-018) cache invalidation test mocks both fetch and DB at the unit level**, so the
  test does not exercise actual Upstash semantics. Specifically, the assertion at
  `tenant-schema.test.ts:267` checks that the URL contains `/del/<encoded-key>` — but Upstash's DEL
  command can return `{result: 1}` for "key existed" or `{result: 0}` for "key did not exist". The
  route doesn't read the result. So a wrong key (e.g. `schemas:` instead of `schema:`, plural typo)
  would silently no-op DEL on every activation and the unit test would still pass. Severity **P3** →
  FOLLOW-059.

#### 4d. Documentation gaps

- **Master Design §Snapshot.1 row B.4 still says "⛔ Blocked — 4 of 6 Sprint-2.5 UI tickets
  BLOCKED."** This is stale as of 2026-05-22: TICKET-030, TICKET-033, and TICKET-AUTO-006-POLISH are
  all DONE per QUEUE.md Sprint 9.5 section. The Snapshot's update note at lines 54-66 was written
  before Sprint 9.5 merged. Required edit specified in §7 below.
- **Master Design §Snapshot.1 row J still says "✅ Shipped — tenants schema with TenantConfig fields
  including `auto_detected_schema`."** This is **incorrect**: `tenants` table never had an
  `auto_detected_schema` column (verified via
  `grep -n auto_detected_schema packages/db/src/schema/tenants.ts` → 0 matches). The canonical store
  is `tenant_site_schemas` (a separate table). The QUEUE preamble for Sprint 9.5 explicitly flagged
  this: "_`tenants.auto_detected_schema` field referenced in Master_Design §J.3 does NOT exist in
  current schema — that section is stale (cleanup follow-up)._" Sprint 9.5 hardened the contract
  around `tenant_site_schemas` (PR #121 caches there, PR #125 activates there, PR #126 invalidates
  there) but the documentation was not updated. Required edits specified in §7.
- **Master Design §Snapshot.4 priority #5** says "Unblock Sprint 2.5 (TICKET-030/032/033/034) —
  without it, no zero-config onboarding demo possible." TICKET-030 + TICKET-033 are now DONE;
  TICKET-032 + TICKET-034 are deferred per Q5 decision 2026-05-21. The priority list is stale.
- **`POST /api/adapt/feedback` is undocumented in MASTER_DESIGN.md.** No mention in §E.3.0 or §E.3.1
  of the SDK-side feedback contract. The endpoint exists but the doc is silent on its shape, auth,
  or expected SDK trigger. → FOLLOW-060.
- **No ADR for `'estalara_staff'` sentinel or the activate-route trust model.** Decisions like "we
  accept any non-empty Bearer when `ADAPT_API_KEY` is unset" need an ADR or at minimum a Master
  Design §V security note. Currently the only reference is a code comment.
- **`packages/shared/src/domains.ts:SDK_CDN_URL` exists but is not referenced from the
  buildSnippet() function in DetectionPreview.tsx.** Documentation gap → code gap, covered in
  FOLLOW-054.

### 5. Cross-PR consistency checks

- **PR #121 and PR #124 ship a contract — `DetectResponseSchema` vs `DetectApiResponse` — twice.**
  PR #121's commit message says "for consumption by TICKET-030." PR #124 then declares its own
  duplicate interface instead of importing the Zod-derived type. Both PRs passed CI in isolation. A
  reviewer reading both diffs in sequence would have caught it; the PM/reviewer didn't because they
  reviewed PRs separately. → FOLLOW-044.
- **PR #122 and PR #123 both ship duplicate code in `apps/decision-api/src/lib/` (bandit + reorder)
  alongside their canonical `packages/shared/` or `apps/control-plane/` location**, with no CI
  enforcement of byte-identity. Pattern repeated. → FOLLOW-052.
- **PR #122 introduces `AdaptationDirectives.variant?: string` (server side) and PR #124 + PR #125
  don't reference it on the client side.** The SDK is the consumer of `AdaptationDirectives` but
  Sprint 9.5 didn't touch the SDK at all. The SDK was last updated in Sprint 9 (TICKET-041 consent
  banner, PR #113). Result: server now generates per-variant signals that no client receives. The
  "variant" string is a free-form `'control'|'v1'|'v2'` contract with no shared enum, no exhaustive
  switch, no SDK consumer. → FOLLOW-042 also covers this; cross-flagging here for visibility.
- **PR #123 ships `listing_embeddings` with the assumption that someone will seed the data, and PR
  #125 ships activation with no automation to call `POST /api/listings/embed` post-activate.** The
  natural workflow ("operator pastes URL → detects → activates → embeddings auto-seed for every
  detected listing") is broken by design — there's no listing enumeration in the wizard, no event
  that fires "tenant now has listings X, Y, Z; embed them." A different ticket would need to bridge
  `tenant_site_schemas` (which knows the listing-card selector) → some listing ingest pipeline →
  `POST /api/listings/embed`. Sprint 9.5 silently assumes this exists. → FOLLOW-046.
- **PR #121 (`DetectRequestSchema`) only accepts `{ url }`; PR #125 (`ActivateRequestSchema`)
  accepts `{ schema }`.** The two routes are designed to be called sequentially from the same
  wizard, but no `detect_request_id` or `schema_id` ties them together. The activate route trusts
  that the body `schema` came from a recent detect call, but nothing prevents an attacker with a JWT
  from POSTing an arbitrary `TenantSiteSchema` to activate. Severity overlaps with 4a — FOLLOW-048.

### 6. Patterns vs prior retros

- **Rule H ("schema/scaffold complete, runtime wiring deferred")** — **5 retros in a row**
  (RETRO-001, RETRO-002, RETRO-003, RETRO-004, RETRO-005). RETRO-005 adds at least 4 new HALF_WIRE
  instances (`/api/adapt/feedback` producer with no SDK consumer; `AdaptationDirectives.variant`
  field with no SDK consumer; `archetype_embeddings.embedding` NULLs with no populator;
  `listing_embeddings` consumer wired but no automated producer for tenant data). Rule H is already
  canonical; this retro REINFORCES that **FOLLOW-024 (Rule H hard pre-merge gate enhancement)** must
  land before the next sprint, or this pattern will continue to dominate retros. The
  `scripts/check-rule-i.sh` script (already a CI gate) caught zero of the Sprint 9.5 half-wires
  because **all 4 new half-wires are at the cross-route / cross-service contract layer**, not the
  within-module exported-symbol layer that Rule I checks.
- **Pattern: "Duplicate logic across decision-api Worker and control-plane Next.js with no CI
  byte-identity enforcement"** — appeared in RETRO-003 §3a (REORDER-001 mirror code), now repeats
  twice in RETRO-005 (PR #122 bandit, PR #123 reorder). Count: **2 retros, 3 instances**.
  **Threshold MET.** Candidate for Rule promotion. Proposed as **Rule J — Mirror-Code Sync Gate** in
  CONVENTIONS_PATCH.md (see end of this retro).
- **Pattern: "PR ships a producer-only HTTP endpoint without an SDK or scheduled-job consumer in the
  same sprint"** — appeared in RETRO-002 (FOLLOW-006 ab.assignment never emitted from SDK,
  FOLLOW-007 thompsonSample never called), now repeats in RETRO-005 (`/api/adapt/feedback`). This is
  a SUB-CASE of Rule H specifically for HTTP endpoints. Count: **2 retros, 3 instances.**
  **Threshold MET** but already covered by Rule H — recommend **AMENDING** Rule H to add the
  explicit HTTP endpoint sub-case rather than spawning Rule K. See section "Rule promotion."
- **Pattern: "Sprint Snapshot row in MASTER_DESIGN.md goes stale immediately after sprint closes"**
  — RETRO-004 §3d flagged Master Design §E.6 / §E.7 as doc-only; now §Snapshot.1 row B.4 + row J are
  stale after Sprint 9.5. Count: **2 retros, 2-3 instances.** **Threshold MET** if we count
  §Snapshot rows as the same class as §E.6/§E.7. However: Snapshot.1 has an explicit "re-verified at
  Sprint completion" rule per OP §Y.3 — so the failure mode here is _the rule wasn't followed for
  Sprint 9.5_. Add this as a process check, not a new rule. → FOLLOW-061.
- **Pattern: "CI billing / infra issue lets a PR merge with no green CI signal"** — PR #125 merged
  with all GitHub Actions billing-blocked. This is a NEW pattern not seen in prior retros. Count:
  **1 retro, 1 instance.** **Threshold NOT YET met.** Track. Rule A explicitly says "verify CI green
  before READY_FOR_REVIEW" — Sprint 9.5 violated this for one PR on the strength of local tests. If
  it recurs, promote to a Rule A amendment.

### 7. Master_Design updates

The following edits are proposed for `docs/MASTER_DESIGN.md`. They are written as exact old → new
replacements and are applied at the end of this retro (Section A — Edits applied).

**Edit M-1 — §Snapshot.1 row B.4 (line 89):**

- **Old:**
  `| B.4 | Auto-Onboarding UI (Magic Link wizard / Auto-Detect Modal / API Connect) | ⛔ **Blocked** | 4 of 6 Sprint-2.5 UI tickets BLOCKED (TICKET-030 READY, TICKET-033/034 not started). No tenant can self-serve onboard today. **Note:** Auto-Detection Engine itself = §B.5 = Mostly Shipped per Sprint 7.5; this row is about onboarding UI specifically. Multiple prior sessions conflated the two. |`
- **New:**
  `| B.4 | Auto-Onboarding UI (Magic Link wizard / Auto-Detect Modal / API Connect) | 🟢 **Mostly Shipped** | Sprint 9.5 merged 2026-05-22: TICKET-033 (PR #121, `POST
  /api/detect`JWT+SSRF+wizard response), TICKET-030 (PR #124,`/dashboard/onboarding/detect`wizard UI), TICKET-AUTO-006-POLISH (PR #125, Detection Preview +`POST
  /api/schema/activate`+ SDK snippet), FOLLOW-018 (PR #126, real tenant schema lookup + cache invalidation). Operator can paste URL → detect → preview → activate → receive snippet end-to-end. **Open gaps:** (a) Magic-Link email flow not yet shipped (TICKET-040 BLOCKED in Sprint 3 — current path requires existing dashboard auth, not a one-click email link); (b) listing-side embedding seeding has no automation (FOLLOW-046 — adapt path degrades to djb2 affinity until operators manually call`POST
  /api/listings/embed`); (c) no end-to-end integration test of detect → activate → adapt (FOLLOW-055). **Note:** Auto-Detection Engine itself = §B.5 = Mostly Shipped per Sprint 7.5. |`

**Edit M-2 — §Snapshot.1 row J (line 106):**

- **Old:**
  `| J | Multi-Tenancy Model | ✅ **Shipped** | tenants schema with TenantConfig fields including `auto_detected_schema`. |`
- **New:**
  `| J | Multi-Tenancy Model | ✅ **Shipped** | `tenants`Postgres table with RLS + JWT-scoped tenant_id. Detected site schemas are persisted in the dedicated`tenant_site_schemas`table (one row per`(tenant_id,
  domain)`), not on `tenants`itself. Master Design §J.3 still describes a`data_schema:
  TenantSchemaMapping`field inline on TenantConfig — that section is documentation-level only; the actual store is the standalone table. (Sprint 9.5 PR #121 / #125 / #126 hardened the contract around`tenant_site_schemas`.) |`

**Edit M-3 — §Snapshot.1 row E.1–E.3 (line 98):**

- **Old:**
  `| E.1–E.3 | Adaptation decision tree + A/B + bandit | 🟡 **Partial** | A/B holdout + Thompson math shipped + tested; variant *selection per request* not wired (always picks index 0). |`
- **New:**
  `| E.1–E.3 | Adaptation decision tree + A/B + bandit | 🟡 **Partial** | A/B holdout + Thompson sampling math shipped + tested + **wired into canonical `POST
  /api/adapt`** (Sprint 9.5 PR #122, FOLLOW-007). Server now selects a `variant` per (tenant, archetype) request and includes it in the response body. **Two half-wires remain:** (1) The SDK (`AdaptResponse`in`packages/sdk/src/core/adapt.ts`) does not have a `variant`field on its consumer interface → can't render different copy per variant (FOLLOW-042). (2)`POST
  /api/adapt/feedback`exists server-side but no SDK code path POSTs to it on conversion →`ab_bandit_weights` will never update from real traffic; Thompson sampling stays at the uniform Beta(1,1) prior (FOLLOW-041). Decision-api Worker (`apps/decision-api/src/app/api/adapt/route.ts`) still on keyword path — by design per ADR-0004 (canonical = control-plane). |`

**Edit M-4 — §Snapshot.1 row F (line 102):**

- **Old:**
  `| F | Data Network Effect (archetype embedding space) | 🟡 **Partial** | `archetype_embeddings` table exists but seeded with **3** archetypes (investor/family/neutral), not 18. |`
- **New:**
  `| F | Data Network Effect (archetype embedding space) | 🟡 **Partial** | `archetype_embeddings`table seeded with all **18** archetypes (migration`0005_seed_archetype_embeddings.sql`, post-Sprint 8). However, every row's `embedding`column is **NULL** — the migration comment says "filled in by the Modal daily job" but no such job exists. Sprint 9.5 FOLLOW-019 (PR #123) added cosine-similarity affinity scoring that reads`archetype_embeddings.embedding`via`fetchArchetypeEmbedding()`; when the column is NULL the code correctly falls back to djb2. Net effect: **cosine path is unreachable in production today; FOLLOW-019's headline claim "real archetype-listing affinity replaces djb2" is functionally a no-op until the archetype embedding vectors are computed.** Wiring task tracked in FOLLOW-043. The new `listing_embeddings` table (migration 0013) is wired but seeding is manual — FOLLOW-046. |`

**Edit M-5 — §Snapshot.1 update note (line 54-66, the "Updates 2026-05-21" prose):**

Insert a new sentence at the end of the existing block:

- **Add after the existing sentence ending "...per Operating Principles Rule 1, this snapshot is the
  SoT for "what is built today" — sections A–W remain target architecture.":**
  `**Update 2026-05-22 (Sprint 9.5 close):** Sprint 9.5 COMPLETE — 6 PRs merged (#121, #122, #123, #124, #125, #126). Auto-Onboarding UI end-to-end demoable on `app.estalara.com` and any new tenant (paste URL → detect → preview → activate → snippet). Bandit variant selection wired in canonical adapt route. Cosine archetype-listing affinity wired with djb2 fallback. **Open gaps surfaced by RETRO-005 that affect demo narrative honesty:** FOLLOW-041 (SDK feedback ping), FOLLOW-042 (SDK variant consumer), FOLLOW-043 (archetype embedding vectors NULL → cosine unreachable), FOLLOW-046 (listing embedding auto-seed), FOLLOW-055 (end-to-end integration test). Per OP §Y.3 the next Snapshot.1 re-verification is at Sprint 10 completion.`

**Edit M-6 — §Snapshot.4 priority #5 (line 172):**

- **Old:**
  `5. Unblock Sprint 2.5 (TICKET-030/032/033/034) — without it, no zero-config onboarding demo possible.`
- **New:**
  `5. ~~Unblock Sprint 2.5 (TICKET-030/032/033/034)~~ **Sprint 9.5 closed 2026-05-22.** TICKET-030 + TICKET-033 + TICKET-AUTO-006-POLISH merged. TICKET-032 + TICKET-034 deferred per Q5 2026-05-21 (auto-detect already covers L1/L2/L4; L3 templates non-blocking). Next priority for end-to-end demo: FOLLOW-041 + FOLLOW-042 (close the bandit loop) and FOLLOW-043 (seed real archetype embeddings so cosine affinity is more than placeholder).`

These edits are applied in Section "Edits applied" at the end of RETRO-005.

### 8. Follow-ups

(Each appended as a stub to `backlog/FOLLOW_UPS.md` in this commit. Numbering continues from
FOLLOW-040.)

- **FOLLOW-041** — SDK feedback ping on outcome events — `POST /api/adapt/feedback` is wired
  server-side but no SDK consumer fires the ping (sdk-engineer + backend-engineer, 4h, **P0**,
  Sprint 10)
- **FOLLOW-042** — Add `variant?: string` to SDK `AdaptResponse` + thread through
  `applyDirectives()` so SDK can echo variant on feedback and (future) render per-variant copy
  (sdk-engineer, 2h, **P0**, Sprint 10 — must land with FOLLOW-041 in the same PR)
- **FOLLOW-043** — Compute archetype embedding vectors — extend `0005_seed_archetype_embeddings`
  data path with a runnable script (Modal job or one-shot Node script) that reads each archetype's
  description and calls OpenAI `text-embedding-3-small` at 1024 dims, then UPDATEs the row
  (ml-engineer, 3h, **P0**, Sprint 10 — unblocks FOLLOW-019's cosine path)
- **FOLLOW-044** — Replace `DetectApiResponse` inline interface in `DetectWizard.tsx` with imported
  `DetectResponse` from `@estalara/shared`; add a Zod runtime guard at fetch-response boundary
  (sdk-engineer, 0.5h, **P2**, Sprint 10)
- **FOLLOW-045** — Decide fate of `apps/decision-api/src/lib/bandit.ts` — keep as Worker rollback
  insurance with documented sync test, OR delete and add ADR-0006 stating control-plane is sole
  canonical path (architect, 1h, **P2**, Sprint 10)
- **FOLLOW-046** — Automate listing embedding seeding — emit a `listing.created` / `listing.updated`
  event from the tenant's listing ingest path (or a backfill cron) that calls
  `POST /api/listings/embed` per listing (data-engineer + backend-engineer, 4h, **P1**, Sprint 11 —
  only pilot-blocking, not demo-blocking)
- **FOLLOW-047** — Reject `claims.tenant_id === null` (staff caller) with a clean 403 from
  `/api/detect` and `/api/schema/activate` instead of falling back to `'estalara_staff'` sentinel →
  uuid parse error → 500 (backend-engineer, 1h, **P1**, Sprint 10)
- **FOLLOW-048** — Tie `POST /api/schema/activate` to the prior detect call: have detect return a
  `detect_request_id`, store it as a column on `tenant_site_schemas`, require it in the activate
  request body, validate the (tenant_id, detect_request_id, domain) tuple (backend-engineer, 2h,
  **P2**, Sprint 10)
- **FOLLOW-049** — Idempotency on `POST /api/schema/activate` — accept an `Idempotency-Key` header,
  dedup within 60s, return the same response for repeat calls (backend-engineer, 1.5h, **P2**,
  Sprint 10)
- **FOLLOW-050** — Document and address Redis read-replica staleness vs cache invalidation ordering
  — proposed ADR + an integration test that simulates DEL → adapt path with a configurable replica
  lag (architect + backend-engineer, 2h, **P1** at multi-region rollout, **P3** today; Sprint 10 —
  block US/UK region deploy until resolved)
- **FOLLOW-051** — Replace presence-only Bearer with a tenant-scoped HMAC or signed SDK ping on
  `POST /api/adapt/feedback`; document threat model in V (compliance-engineer + backend-engineer,
  3h, **P1**, Sprint 10 — blocks any external pilot exposing the feedback endpoint)
- **FOLLOW-052** — Mirror-code byte-identity CI check — `scripts/check-mirror-files.sh` that
  compares `apps/decision-api/src/lib/{bandit,reorder}.ts` against their canonical sources and fails
  CI on drift (qa-engineer + devops-engineer, 1.5h, **P1**, Sprint 10) — promotes the candidate Rule
  J pattern enforcement
- **FOLLOW-053** — Make `detect_confidence` consistent across AI-Vision-fallback path — ensure
  `detectionConfidence` denormalised column and `schema.detection_confidence` JSON value never
  disagree post-fallback (backend-engineer, 1h, **P3**, Sprint 11)
- **FOLLOW-054** — Use `SDK_CDN_URL` constant in `buildSnippet()`; decide on versioned vs
  unversioned snippet URL; align with Master Design §V.5.2 (frontend + architect, 0.5h, **P2**,
  Sprint 10 — block any tenant onboarding before CDN URL is correct)
- **FOLLOW-055** — End-to-end integration test for the demo flow — detect → activate → adapt →
  assert `variant` field present → assert ReorderDirective uses cosine (mock embeddings) → assert
  SDK applyDirectives mutates DOM (qa-engineer, 5h, **P0**, Sprint 10 — gates investor demo
  confidence)
- **FOLLOW-056** — Extend auto-detect corpus to include a URL-based fixture path that exercises SSRF
  guard + cache guard at the route layer (qa-engineer, 2h, **P2**, Sprint 11)
- **FOLLOW-057** — Test asserts activate route WHERE clause includes `status: 'pending'` filter;
  prevent silent revival of `suspended` tenants (qa-engineer, 0.5h, **P2**, Sprint 10 — fold into
  FOLLOW-055 PR if convenient)
- **FOLLOW-058** — Concurrency / race test for the 60-second cache guard — fire N parallel identical
  requests, assert only one runs detection (qa-engineer, 1.5h, **P2**, Sprint 11)
- **FOLLOW-059** — Read DEL response from Upstash and log/alert on result=0 (key didn't exist) to
  catch typos in cache key naming (backend-engineer, 0.5h, **P3**, Sprint 11)
- **FOLLOW-060** — Document `POST /api/adapt/feedback` contract in Master Design §E.3 (shape, auth,
  expected SDK trigger, latency budget) — also document `POST /api/listings/embed` (architect, 1h,
  **P2**, Sprint 10)
- **FOLLOW-061** — Enforce OP §Y.3 Snapshot.1 re-verification at every sprint close — add as the
  last step of the PM-orchestrator sprint-close checklist; this retro's Edits M-1..M-6 satisfy the
  obligation for Sprint 9.5 retroactively (architect + pm-orchestrator, 0.5h, **P1**, Sprint 10
  process change)

### 9. Cross-references

- **RETRO-001 (TICKET-046):** Originated FOLLOW-001 (variant_index wiring) and FOLLOW-002
  (copy_template pipeline). FOLLOW-007 (Sprint 9.5 PR #122) closes part of FOLLOW-001 but the SDK
  side (now FOLLOW-042) remains. RETRO-001's "variant_index" hypothesis morphed into "variant" (free
  string) at implementation — RETRO-004 §3a proposed `variant_index?: 0|1|2` as FOLLOW-025; PR #122
  chose a different contract (`variant: string`). This is a tactical divergence but FOLLOW-025
  should be either retired or its spec updated to match what shipped.
- **RETRO-002 (TICKET-AB-001):** Rule H was promoted here. Every Sprint 9.5 PR is graded against it.
  RETRO-005 confirms Rule H is the dominant pattern still. FOLLOW-006 (ab.assignment event emission)
  was closed by Sprint 8.5 PR #106; FOLLOW-007 closed (with caveats) by Sprint 9.5 PR #122;
  FOLLOW-008 closed by Sprint 8.5 PR #107; FOLLOW-010 closed by Sprint 8.5 PR #107; FOLLOW-014
  closed by Sprint 8.5 PR #108. The Sprint 8 → Sprint 9.5 chain has steadily closed RETRO-002's gaps
  — good. The new gaps in RETRO-005 are structurally similar (the producer ships before the
  consumer).
- **RETRO-003 (TICKET-REORDER-001):** FOLLOW-015 (decision-api ReorderDirective) and FOLLOW-019
  (real archetype affinity) both shipped this sprint — FOLLOW-015 in Sprint 8.5 PR #108, FOLLOW-019
  in Sprint 9.5 PR #123. The duplication concern RETRO-003 raised is now amplified (bandit + reorder
  both mirrored) — promoted to Rule J candidate.
- **RETRO-004 (TICKET-046 deep re-analysis):** FOLLOW-025 (variant_index on TextDirective) was
  superseded by PR #122's choice of `variant: string` on AdaptationDirectives. FOLLOW-028 (SDK
  fingerprint widening) is contingent on FOLLOW-042 landing. FOLLOW-031 (locale fallback) and
  FOLLOW-034 (fair-housing audit) are unaffected by Sprint 9.5. The "Master Design section describes
  runtime behavior with NO code implementing it" pattern from RETRO-004 §5 — now reinforced by
  §Snapshot.1 row J / B.4 staleness in RETRO-005 §4d. FOLLOW-061 addresses the process gap.
- **CONVENTIONS_PATCH.md Rule H:** Re-confirmed by 4 new instances this sprint. Pattern is endemic;
  CI Rule I gate insufficient at the cross-service contract layer (it checks within- module exports,
  not cross-route HTTP contracts).
- **CONVENTIONS_PATCH.md Rule A:** Violated once this sprint (PR #125 merged with CI
  billing-blocked). Single instance; tracked but not promoted to amendment yet.
- **CONVENTIONS_PATCH.md proposed Rule J — Mirror-Code Sync Gate:** Promoted in this retro (see next
  section).

### 10. Rule promotion

**New Rule J — Mirror-Code Sync Gate** is appended to `CONVENTIONS_PATCH.md` in this commit.
Threshold met: pattern appeared in **RETRO-003** (FOLLOW-015 reorder logic mirror) and **RETRO-005**
(PR #122 bandit mirror, PR #123 reorder mirror). Both retros explicitly flag the duplication as
"byte-identical" or "kept in sync" with no CI enforcement.

### Edits applied (Section A)

This retrospective directly modifies `docs/MASTER_DESIGN.md` per Edits M-1 through M-6 specified in
§7. Hashes of original sections preserved in this entry. Applied 2026-05-22 by
retrospective-analyst.

---

## RETRO-006 — Sprint 10 (Close the bandit loop + real embeddings + e2e test) — 2026-05-24

**Scope:** Sprint-level retrospective bundling 8 merged PRs (#127, #128, #129, #130, #131, #132,
#133, #134). Sprint 10 was the immediate follow-on from Sprint 9.5 — its explicit goal in QUEUE.md
was to "close the bandit loop, make cosine affinity real end-to-end (archetype + listing vectors
both seeded), and verify the demo end-to-end in CI." Six of the eight PRs originated as FOLLOW-NNN
stubs surfaced by RETRO-005 (i.e., this sprint is the literal "fix what last sprint half-shipped"
sprint); two are new findings (FOLLOW-051 feedback auth hardening; FOLLOW-052 mirror-code CI gate).

### Sprint-level rollup

| Metric                            | Value                                                                    |
| --------------------------------- | ------------------------------------------------------------------------ |
| Sprint goal                       | Close bandit loop + real embeddings + e2e demo test                      |
| PRs merged                        | 8 (#127 → #134), all squash-merged to `main`                             |
| Ticket completion                 | 8 / 9 planned tickets DONE (FOLLOW-061 merged, was the sprint's last)    |
| Tickets DEFERRED                  | 0 (Sprint 11 carries FOLLOW-039 from Sprint 9.5)                         |
| Estimated → actual hours          | 24h planned (4+2+3+5+3+4+3+1.5+0.5); +6h unplanned (FOLLOW-043 re-fixes) |
| CI green on first push            | 5/8 (PR #131 needed 6 follow-up commits to land seed workflow)           |
| Mean PR latency (open → merge)    | ~12h                                                                     |
| Files changed (sprint cumulative) | 41                                                                       |
| Lines added / removed             | +3,047 / −69                                                             |
| New routes                        | 0 (existing `POST /api/adapt/feedback` hardened to HMAC)                 |
| New scripts (npm/pnpm)            | 2 (`pnpm seed:archetypes`, `pnpm seed:listings`)                         |
| New CI jobs                       | 1 (`rule-j` mirror-code byte-identity check)                             |
| New permanent Rules               | 1 (Rule J — already promoted in CONVENTIONS_PATCH.md via PR #128)        |
| Repeating retros' pattern hit     | Rule H — 6 retros in a row (now stably codified)                         |

**Velocity vs plan:** Sprint 10 hit its plan within budget on the wire-up tickets; the only
overshoot was FOLLOW-043 (archetype embedding seed), which needed six post-merge commits (`0ec3a7d`,
`d16fb07`, `12fe824`, `b5a7103`, `d237051`, `82b9e2e`) to actually become operable in the GitHub
Actions workflow — the underlying problem was deployment-environment friction (Supabase IPv6-only
direct host, Doppler password mismatch, missing `DATABASE_URL_ADMIN`, `OPENAI_API_KEY` not in
Doppler dev). The seed script merged green but did not actually seed any vectors until the sixth
fix. This is a Rule H sub-pattern: "the seed script exists but the operational path to _run_ it is
broken." See §4a (gap LG-1).

**Six of eight PRs were direct closures of RETRO-005 half-wires.** RETRO-005 identified four
HALF_WIRE_P findings (`/api/adapt/feedback` no SDK consumer, `AdaptationDirectives.variant` no SDK
consumer, `archetype_embeddings.embedding` NULL with no producer, `listing_embeddings` consumer with
no automated producer). Sprint 10 closed all four with PR #127 (FOLLOW-041/042 — SDK feedback ping +
variant field), PR #131 (FOLLOW-043 — archetype embedding seed script + workflow), and PR #132
(FOLLOW-046 — on-activation listing embedding trigger + demo manifest). The remaining two PRs
addressed the security gap FOLLOW-051 surfaced by RETRO-005 §4a (PR #133) and the **process** gap
FOLLOW-061 (PR #134 — sprint-close Snapshot.1 re-verification). Net: Sprint 10 is the most
disciplined "retro-driven" sprint shipped to date.

**Repeating patterns across the 8 PRs:**

1. **Rule H (schema scaffold / deferred wiring)** — 6 retros consecutive. RETRO-006 records ONE new
   HALF*WIRE finding (LG-2 below — `feedbackConvertedFalse` SDK opt-in has no documented operator
   surface), but the dominant story is Rule H \_closure*: Sprint 10 reduced the open half-wire count
   by 4 net. The pattern persists structurally — see §6 for a recommended Rule H amendment.
2. **Mirror-code duplication** — Rule J was _promoted to permanent_ in PR #128 (FOLLOW-052). The CI
   gate is live; the two declared pairs (`bandit.ts` and `reorder.ts`) are enforced. This is the
   only "new Rule" delta from Sprint 10. Rule J already lives in CONVENTIONS*PATCH.md (added during
   RETRO-005); PR #128 only added the \_enforcement script*.
3. **Doppler/CI infrastructure friction** — FOLLOW-043 needed six retry commits. The Doppler dev
   config is the single root cause: `SUPABASE_DB_PASSWORD` mismatch, `DATABASE_URL_ADMIN` missing,
   `OPENAI_API_KEY` absent. FOLLOW-040 was meant to harden Doppler CI hygiene but is still parallel
   pre-flight (per Sprint 9.5 preamble). This recurs.
4. **Deferred SDK auth ratcheting** — PR #127 shipped SDK feedback ping with **presence-only Bearer
   auth** on 2026-05-22; PR #133 then ratcheted the server to **HMAC-SHA256** on 2026-05-23 AND had
   to ship a matching SDK update in the same PR. This is the "ship the client first, harden the
   server, ship a client update one day later" pattern. The SDK update IS in PR #133, so the
   contract is internally consistent at end of sprint — but the window 2026-05-22 → 2026-05-23 has a
   16-hour gap where SDK#127 + server#127 spoke unsigned Bearer. Demo-safe (no real tenants), but
   shipped main was insecure for 16h. See §4a LG-3.

### 1. Summary of change

| PR   | Ticket                  | Title                                                        | Files | +/−        | Merged                                                  |
| ---- | ----------------------- | ------------------------------------------------------------ | ----- | ---------- | ------------------------------------------------------- |
| #127 | FOLLOW-041 + FOLLOW-042 | SDK feedback ping + variant field                            | 4     | +552 / −3  | 2026-05-22 12:24Z `32d9bb3`                             |
| #128 | FOLLOW-052              | Mirror-code byte-identity CI check (Rule J enforcement)      | 7     | +194 / −12 | 2026-05-22 12:25Z `d3bcd4e`                             |
| #129 | FOLLOW-047              | Reject null tenant_id with 403 STAFF_TENANT_CONTEXT_MISSING  | 6     | +77 / −5   | 2026-05-22 12:26Z `83f98d8`                             |
| #130 | FOLLOW-055              | E2E integration test detect→activate→adapt→SDK               | 7     | +603 / −7  | 2026-05-22 12:27Z `b0f3df9`                             |
| #131 | FOLLOW-043              | Archetype embedding vectors seed script                      | 5     | +391       | 2026-05-22 12:33Z `83761b9` (+6 fix commits 2026-05-22) |
| #132 | FOLLOW-046              | Auto-seed listing embeddings on tenant activation            | 8     | +814       | 2026-05-22 22:35Z `059ffd9`                             |
| #133 | FOLLOW-051              | Tenant-scoped HMAC-SHA256 auth on `POST /api/adapt/feedback` | 7     | +524 / −43 | 2026-05-23 15:23Z `c596821`                             |
| #134 | FOLLOW-061              | Add Snapshot.1 re-verification to sprint-close checklist     | 4     | +122 / −3  | 2026-05-23 15:18Z `480af35`                             |

**Cumulative:** 41 files changed across the sprint, +3,047 / −69. Key new artefacts:

- `packages/sdk/src/core/adapt.ts` — `cacheVariant()`, `getCachedVariant()`, `deriveFeedbackUrl()`,
  `postFeedbackPing()`, `registerFeedbackListener()`, `computeHmacSha256Hex()` (added in #127, HMAC
  added in #133)
- `packages/sdk/src/core/config.ts` — `feedbackEvents?`, `feedbackUrl?`, `feedbackConvertedFalse?`
- `apps/control-plane/src/app/api/adapt/feedback/route.ts` — HMAC verification (added in #133)
- `packages/shared/src/errors.ts` — `ErrorCode.STAFF_TENANT_CONTEXT_MISSING`
- `apps/control-plane/src/lib/seed-listing-embeddings.ts` — fire-and-forget seeding helper +
  12-entry `DEMO_LISTING_MANIFEST`
- `apps/control-plane/scripts/seed-archetypes.mts` — one-shot embedding seed (PostgREST after fix
  commits)
- `apps/control-plane/scripts/seed-estalara-listings.mts` — backfill script
- `tests/e2e/sprint-9-5-demo.spec.ts` — 5 static contract tests + 5 E2E steps (guarded by
  `NEXT_PUBLIC_TEST_E2E=true`)
- `scripts/check-mirror-files.sh` + `scripts/mirror-files.json` — Rule J enforcement
- `.github/workflows/seed-archetypes.yml` — manual workflow_dispatch for seeding
- `docs/AGENT_WORKFLOW.md` — new "Sprint-close checklist" section
- `.claude/agents/pm-orchestrator.md` — step 8 "Sprint close"
- `docs/MASTER_DESIGN.md` v2.1 → v2.2 (§V.3.2 threat model + checklist forward-ref)

**Key contracts changed:**

- `AdaptResponse.variant?: string` — ADDED (additive, optional) — breaking: no — consumer wired into
  SDK same PR — Rule H satisfied
- `SdkConfig.feedbackEvents?: string[]`, `feedbackUrl?: string`, `feedbackConvertedFalse?: boolean`
  — ADDED (additive, optional) — breaking: no
- `ErrorCode.STAFF_TENANT_CONTEXT_MISSING` — ADDED to enum — breaking: no
- `POST /api/adapt/feedback` auth scheme — CHANGED from presence-only Bearer to HMAC-SHA256 (with
  `ADAPT_API_KEY` env override) — breaking: yes for any non-SDK caller; SDK updated in same PR
- `MIRROR_FILES` manifest (`scripts/mirror-files.json`) — NEW contract declaring 2 file-pair mirrors

### 2. Verification in PRs

- Test files added/changed: 9 across the sprint (44 → 47 new SDK tests; 31 new feedback route tests;
  35 new control-plane tests for seed-listing-embeddings + activate-trigger; 200 added across
  embedding-lookup; 576 lines added in the e2e spec).
- Coverage delta: control-plane 481 → 516 tests (PR #133 final count) → an estimated 530+ with
  FOLLOW-046's 15 new tests.
- CI checks: **All 8 PRs landed with green TypeScript/JS lanes** (per `gh pr checks` review at retro
  time). The four pre-existing baseline failures (`Doppler verify`, `Rule I` legacy dead code, 7×
  `Test (Python)` scaffolding, `Vercel Preview` rate-limit on some PRs) recur and are explicitly
  ignored per QUEUE.md preamble. **No PR repeated the PR #125 incident** (CI billing-blocked, merged
  on local-test confidence only) — Rule A held for the entire sprint.
- Demonstrable end-to-end: PR #130 added a vitest integration spec that exercises the full
  detect→activate→adapt chain _but is guarded behind `NEXT_PUBLIC_TEST_E2E=true`_. The five steps
  inside `describe.skipIf(!RUN_E2E)` only run when an operator provisions a tenant and starts the
  Next.js server; they do not run under `pnpm test` in CI. The 5 _static contract_ assertions (grid
  builder, ReorderDirective sort, TextDirective DOM mutation, fixture schema validation, score
  invariant) DO run unconditionally in CI. **Net:** the demo's structural contracts are CI-tested,
  but the end-to-end _integration path itself_ still requires a manual / scripted bring-up — see §4c
  TG-1.

**NOT verified by tests (load-bearing gaps — see §4c):**

- **No CI step actually runs `pnpm seed:archetypes` or `pnpm seed:listings`.** The seeds are
  one-shot scripts behind a manual `workflow_dispatch` job (`.github/workflows/seed-archetypes.yml`)
  - manual operator invocation respectively. There is no automated assertion that
    `archetype_embeddings.embedding` is non-NULL in dev/staging at any moment in time.
- **No SDK test verifies the HMAC signature is actually computed against the correct request body
  byte sequence.** PR #133's SDK tests mock `crypto.subtle` for determinism and assert the
  `X-Estalara-Signature` header is present — but no test computes HMAC against a known fixture and
  asserts the SDK-computed hex matches the server-computed hex. A subtle JSON-encoding divergence
  (key ordering, whitespace, escaping) between server and SDK would silently reject every legit
  ping. See §4c TG-2.
- **The 16h presence-only-Bearer window (2026-05-22 → 2026-05-23) is not regression-tested.** If a
  future revert of #133 reintroduces presence-only auth, no automated red signal fires. See §4c
  TG-3.

### 3. Wiring Audit

This sprint is dominated by Rule H _closure_ (HALF_WIRE_P findings from RETRO-005 closed). New
findings are scoped narrowly to the newly-introduced surface.

**CHECK A — Dead code detection:**

Each new exported / first-party file in the 8 PRs was grepped for non-test importers:

- `packages/sdk/src/core/adapt.ts` — `cacheVariant`, `getCachedVariant`, `deriveFeedbackUrl`,
  `postFeedbackPing`, `registerFeedbackListener`, `computeHmacSha256Hex` — all internal helpers
  consumed by `fetchDirectives()` (verified, 1+ non-test importer each). **Clean.**
- `apps/control-plane/src/lib/seed-listing-embeddings.ts` — `seedListingEmbeddingsForActivation()`
  consumed by `apps/control-plane/src/app/api/schema/activate/route.ts`. `DEMO_LISTING_MANIFEST`
  consumed by both the activation path and the backfill script. **Clean.**
- `apps/control-plane/scripts/seed-archetypes.mts` — invoked via `pnpm seed:archetypes` declared in
  root `package.json` AND via the new GitHub Actions workflow
  `.github/workflows/seed-archetypes.yml`. Operator-runnable. **Clean** (script entrypoint pattern,
  framework-discovered).
- `apps/control-plane/scripts/seed-estalara-listings.mts` — invoked via `pnpm seed:listings`
  declared in root `package.json`. Operator-runnable. **Clean.**
- `scripts/check-mirror-files.sh` — invoked by CI job `rule-j` and by `lefthook.yml` pre-push hook.
  **Clean.**
- `tests/e2e/sprint-9-5-demo.spec.ts` — vitest spec, discovered by the e2e workspace test runner.
  **Clean** (framework-discovered test file).
- `ErrorCode.STAFF_TENANT_CONTEXT_MISSING` — consumed by both `detect/route.ts` and
  `activate/route.ts`. **Clean.**

No DEAD_CODE candidates this sprint.

**CHECK B — Half-wire detection:**

New events / env vars / DB columns / SDK signals introduced:

- **Env var `INTERNAL_API_SECRET`** — producer: documented in `.env.example`; consumer:
  `seed-listing-embeddings.ts:208` reads `process.env.INTERNAL_API_SECRET` for service-to-service
  auth header. **Producer present, consumer present.** ✅
- **Env var `DEMO_TENANT_ID`** — producer: `.env.example` line added in PR #132; consumer:
  `seed-listing-embeddings.ts:101` reads it to gate the demo-manifest path. ✅
- **Env var `ADAPT_API_KEY`** — consumer at `feedback/route.ts:144` (Bearer-token fallback when HMAC
  unused). Producer: documented in Doppler but the auditor did not independently verify presence in
  `prd` Doppler config (RETRO-005 also flagged this). **HALF_WIRE_C uncertain** — if unset in
  production, the endpoint reverts to "any non-empty Bearer accepted" before HMAC fallback kicks in.
  PR #133 documented this as accepted but verify in §6. → flagged in §4a (LG-3), no new FOLLOW.
- **SDK config field `feedbackConvertedFalse`** — consumer at `adapt.ts:197` (registers
  `visibilitychange → hidden` listener with ≥30s dwell). Producer: **no operator surface documents
  this option** — `.env.example` doesn't mention it, no dashboard control, no docs in
  `docs/SDK_CONFIG.md` (file doesn't exist). The field is consumer-only with no documented producer
  workflow. **HALF_WIRE_P** (the producer would be the operator setting it, but there's no
  documented surface). Priority **P3** documentation-only → **FOLLOW-062**.
- **SDK feedback ping body field `converted: boolean`** — producer: `postFeedbackPing()`; consumer:
  `feedback/route.ts:41` Zod schema reads `converted`, passes to
  `updateBanditArm(alpha, beta, converted)`. ✅
- **HMAC header `X-Estalara-Signature`** — producer: SDK
  `packages/sdk/src/core/adapt.ts:computeHmacSha256Hex` + sent in fetch headers (PR #133 SDK
  update); consumer: server `feedback/route.ts` HMAC verify (PR #133 server update). Both ends
  shipped same PR. ✅
- **ClickHouse column `adaptation_decisions.variant`** — added migration 0010 in Sprint 9.5 (PR
  #122); producer: control-plane adapt route logs `variant` per-decision; consumer: nobody reads
  `variant` from ClickHouse in Sprint 10. The bandit-feedback loop reads from `ab_bandit_weights`
  (Postgres), not ClickHouse. The variant column in CH is an _analytics_ column awaiting an
  unwritten dashboard. **HALF_WIRE_P pre-existing** from Sprint 9.5; not a Sprint 10 finding.
- **Database column `archetype_embeddings.embedding`** — producer: `pnpm seed:archetypes` script (PR
  #131 + 6 fix commits). Consumer: `fetchArchetypeEmbedding()` in
  `apps/control-plane/src/lib/embedding-lookup.ts`. ✅ once the script is actually run against a
  given DB. **Operational gap**: the script's "run once after merge" requirement is documented in
  the script header but no automated enforcement exists. → see §4a LG-1.
- **Database table `listing_embeddings`** — producer: `POST /api/listings/embed` + on-activation
  trigger (PR #132). Consumer: adapt route's `fetchListingEmbeddings()` (Sprint 9.5 PR #123). ✅ for
  the demo tenant (12-listing manifest auto-seeded). **HALF_WIRE_P** for non-demo tenants: the PR
  #132 manifest path is hardcoded to `tenantId === DEMO_TENANT_ID`; any new real tenant's listings
  still need manual ingestion via the backfill script or future automation. → see §4a LG-4 (already
  covered by FOLLOW-046's "non-demo automation" carve-out — no new FOLLOW).
- **Mirror manifest entries** — `mirror-files.json` declares 2 pairs. Both files are mirrored on
  `main` (`check-mirror-files.sh` passes locally per PR #128 description). ✅

**Net Wiring Audit:** **1 new HALF_WIRE_P (P3, FOLLOW-062)**. RETRO-005's 4 P0/P1 HALF_WIRE findings
are CLOSED. This is the cleanest wiring audit since the loop began.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 — FOLLOW-043 ships a seed script but the seed never auto-runs anywhere.** The 18-row
  `archetype_embeddings` table still has `embedding = NULL` for any developer who pulls `main`
  fresh, until they (a) configure Doppler dev with `SUPABASE_SERVICE_ROLE_KEY` + `OPENAI_API_KEY`,
  (b) build `@estalara/db`, (c) invoke `pnpm seed:archetypes`. The new GitHub Actions workflow
  (`seed-archetypes.yml`) is a manual `workflow_dispatch` — it does not run on push, on schedule, or
  on tenant onboarding. The README does not document this requirement. CI does not enforce it (no
  assertion that `embedding IS NOT NULL FOR ALL` archetypes). Result: the cosine-affinity path added
  by FOLLOW-019 (Sprint 9.5) and the seed script added by FOLLOW-043 are _technically wired_ but
  **functionally unreachable in any environment where an operator has not manually run the
  workflow**. The 6 fix-commits after the initial merge prove this gap: it took 6 attempts to make
  the seed _runnable in CI_; nobody has yet made it _runnable automatically_. Severity **P1** for
  the next operator/onboarding session, **P2** for the live demo if the production DB has been
  seeded once. → **FOLLOW-063** (P1, devops-engineer + ml-engineer, 2h, Sprint 11) — add a CI
  precheck job that fails when the dev DB has any `archetype_embeddings.embedding IS NULL`, plus a
  README/runbook entry.
- **LG-2 — SDK `_feedbackListenerRegistered` is a module-scoped boolean, not per-instance.** At
  `packages/sdk/src/core/adapt.ts:143` the module-level `let _feedbackListenerRegistered = false`
  guards double-registration. In a single-page application that calls `fetchDirectives()` multiple
  times across route changes — or in any pathological case where the SDK is loaded into multiple
  iframes / shadow roots — the boolean does NOT reset per SDK instance. The reset function
  `resetAdaptState()` at line 159 sets it back to false, but `fetchDirectives()` does not call
  `resetAdaptState()` — only the test suite does. **In practice this is benign** (the listener
  attaches to `document` once, and the guard correctly prevents double-attach). But the module-
  level singleton becomes fragile if SDK is ever loaded twice in the same window (TICKET-NATIVE-001
  scenarios, or a tenant who embeds two SDK instances for two different listing grids on the same
  page). Severity **P2** latent. → **FOLLOW-064** (P2, sdk-engineer, 1h, backlog) — promote the
  guard to a `WeakMap<Document, boolean>` keyed on document and a per-config init token, OR document
  this as a hard SDK constraint in Master Design §B.1.
- **LG-3 — 16-hour security regression window 2026-05-22 → 2026-05-23.** PR #127 (merged 2026-05-22
  12:24Z) shipped the SDK feedback ping with `Authorization: Bearer ${config.apiKey}` and no HMAC.
  The server (`feedback/route.ts` at that point) accepted any non-empty Bearer when `ADAPT_API_KEY`
  was unset (RETRO-005 §4a LG-5 + FOLLOW-051). PR #133 closed both ends 2026-05-23 15:23Z. **For 16
  hours, `main` shipped a self-consistent but unauthenticated feedback path that allowed adversarial
  bandit poisoning.** Today there are no real tenants, so no production exposure occurred. But the
  _pattern_ — ship a feature with weak auth, then ratchet auth in a follow-up PR — is the same
  pattern that produced FIX-013..019 in Sprint 8. RETRO-002 and RETRO-003 already flagged this;
  Sprint 10 repeats it once. Severity **P1** for the _pattern_; **P0** if a pilot launch had
  occurred during the window. **No new FOLLOW — this is a Rule A\* / Rule H amendment candidate (see
  §6).** Process check: PR #127 review comments should have caught "this endpoint mutates DB without
  signed auth," but the SDK PR was scoped to "close the bandit loop" and the auth question was
  scheduled separately. Recommend amending the PM-orchestrator pre-READY_FOR_REVIEW checklist to
  include a "is the auth surface tight enough to land first?" question for any PR that touches an
  endpoint that mutates a DB.
- **LG-4 — `seed-listing-embeddings.ts` `findOpenAIKey()` race in concurrent activations.** The
  helper calls `process.env.INTERNAL_API_SECRET` and `process.env.DEMO_TENANT_ID` at module load but
  reads `OPENAI_API_KEY` (indirectly via `POST /api/listings/embed`) only at request time. If two
  operators activate two tenants within 1 second (unlikely in dev, possible at scale), both
  fire-and-forget background fetches race to mutate `listing_embeddings`. The embed endpoint uses
  upsert semantics so the data layer is safe, but the _cost_ of double-embedding is paid (a few
  extra OpenAI calls). Severity **P3**. **No new FOLLOW** — acceptable; document in Master Design §F
  when FOLLOW-060 lands.
- **LG-5 — `requestId` in `POST /api/schema/activate` is generated _inside_ the handler (PR #129)
  but the same handler had no `requestId` before PR #129's fix.** This is fine going forward — every
  error body now carries one. But every log line emitted BEFORE PR #129's edit (i.e. every
  activation since the route shipped on 2026-05-22) had no correlation ID. Backfilling logs is
  impossible; this is just a "we lost a few hundred bytes of observability for ~24h" — note as
  context only. **No follow-up.**

#### 4b. Code bugs not caught

- **CB-1 — `postFeedbackPing()` swallows ALL errors silently to `console.warn`, including
  authorization failures.** At `packages/sdk/src/core/adapt.ts:91-96` (and the HMAC path in PR
  #133), every fetch error path lands in `console.warn`. If a tenant's `config.apiKey` is wrong /
  rotated / revoked, every conversion signal silently fails. The bandit will sit at uniform
  Beta(1,1) forever and the operator has no signal. Severity **P2** because a) feedback is
  fire-and-forget by design, b) `console.warn` _is_ visible in browser devtools, but c) no
  ClickHouse log records the failure (the feedback route only logs successes when DB upsert works).
  → **FOLLOW-065** (P2, sdk-engineer + backend-engineer, 1.5h, Sprint 11) — emit a synthetic
  `events.feedback.send_failed` event (existing event taxonomy) when the ping returns 4xx/5xx, so
  the dashboard can count failures.
- **CB-2 — `FeedbackBodySchema.tenant_id: z.string().min(1).max(256)` accepts the literal string
  `'undefined'`.** At `feedback/route.ts:37`, `tenant_id` is loosely typed. The SDK sends
  `tenant_id: config.tenantId`. If a tenant misconfigures the SDK with `tenantId: undefined`, the
  fetch body serializes as `{"tenant_id":"undefined", ...}` (because we constructed the object
  literally) — but the SDK actually checks `if (!config.tenantId) return;` at line 73, so this
  early-returns. **Latent**: any future refactor that drops the early-return would let `'undefined'`
  poison the bandit table. Severity **P3** latent. → **FOLLOW-066** (P3, backend-engineer, 0.5h,
  backlog) — tighten the Zod schema to `z.string().uuid()` or `z.string().regex(/^[a-z0-9-_]+$/)`.
- **CB-3 — `applyArchetypeHints()` from RETRO-005 §Snapshot.4 priority #1 is STILL not called at SDK
  init.** Sprint 10's brief did not include this item. The Snapshot.1 §F entry references the
  cold-start optimization. The function is still imported nowhere outside its test. Severity **P2**
  cold-start performance / demo polish. **No new FOLLOW — already an open backlog item; flag for
  Sprint 11 priority promotion.**
- **CB-4 — `tests/e2e/sprint-9-5-demo.spec.ts:35` hardcodes
  `E2E_BEARER_TOKEN ?? 'e2e-demo-bearer- token'` as a fallback.** Anyone running the spec locally
  without `E2E_BEARER_TOKEN` set will fire requests with this literal string. The detect / activate
  / feedback routes all require a real JWT (now stricter after FOLLOW-047 + FOLLOW-051). So the
  fallback Bearer will produce 401s, and the test will fail. That's _correct_ behavior — but the
  failure surfaces as "test failed" without a useful "you must set `E2E_BEARER_TOKEN`" message.
  Severity **P3** ergonomic. → **FOLLOW- 067** (P3, qa-engineer, 0.25h, backlog) — add a
  `beforeAll()` precheck that asserts `E2E_BEARER_TOKEN` is set when `RUN_E2E === true` and skips
  with a clear message otherwise.

#### 4c. Test coverage gaps

- **TG-1 — The "end-to-end demo" test (PR #130 / FOLLOW-055) is _guarded behind an opt-in flag_ that
  nothing in CI sets.** The 5 E2E steps inside `describe.skipIf(!RUN_E2E)` only run when
  `NEXT_PUBLIC_TEST_E2E === 'true'` AND `E2E_BASE_URL` points at a running Next.js server. **There
  is no CI job that brings up that server and sets the flag.** The static contract tests (5
  assertions) DO run on every push and catch regression in fixture schema / DOM mutation logic. But
  the _integration_ — does the SDK actually receive the variant the server sends? does the feedback
  ping reach the DB? does the activated tenant get a working adapt response? — is exactly what
  RETRO-005 §4c flagged as missing, and PR #130 ships the _spec for it_ without running it. Severity
  **P0** for genuine demo confidence; **P1** if interpreted as "we have a working blueprint that an
  operator can run before any pilot." → **FOLLOW-068** (P1, qa-engineer + devops-engineer, 4h,
  Sprint 11) — provision a `demo-integration` CI job that starts Next.js against a Supabase seed DB,
  runs the E2E spec, tears down. Without this, RETRO-005 §4c FOLLOW-055 is mechanically closed but
  its INTENT is not satisfied.
- **TG-2 — No HMAC compatibility test between SDK and server.** PR #133 unit-tests each side with
  internal mocks; nothing asserts
  `SDK.computeHmacSha256Hex(key, body) === server.hmacSha256Hex(key, body)` for a known fixture. If
  the SDK's `JSON.stringify` of the body diverges from the body the server reads via `req.text()`
  (e.g. extra whitespace, key ordering, BOM, UTF-8 normalization), all pings silently 401. Severity
  **P1** — this is the single hot path that proves the FOLLOW-051 hardening actually works in
  production. → **FOLLOW-069** (P1, qa-engineer + backend-engineer, 2h, Sprint 11) — add a
  cross-runtime fixture test in `packages/shared/__tests__/cross-runtime/` (already a precedent for
  Rule J): given a JSON body string and a key, assert SDK + server compute identical hex.
- **TG-3 — No regression test asserts feedback endpoint rejects presence-only Bearer.** PR #133
  rebuilt the auth path; a future revert (or a junior dev "fixing CI by relaxing auth") could
  reintroduce the LG-3 vulnerability and CI would not catch it. → folded into FOLLOW-069 AC ("also
  assert: a request WITHOUT `X-Estalara-Signature` is rejected with 401 when `ADAPT_API_KEY`
  unset").
- **TG-4 — Mirror-code test does not extend to `apps/decision-api/src/lib/affinity.ts` /
  `cosine.ts`.** Rule J is enforced for `bandit.ts` and `reorder.ts` mirror pairs. PR #123 (Sprint
  9.5) shipped a `cosineSimilarity()` and `affinityScore()` that appear in BOTH `decision-api/lib/`
  and `apps/control-plane/src/app/api/adapt/route.ts`. RETRO-005 §4b CB-2 explicitly called this
  out. PR #128's manifest covers `reorder.ts` (which contains `buildReorderDirective` + a
  re-exported `affinityScore`), but if a future split moves cosine math to a separate file, the
  manifest must follow. → **FOLLOW-070** (P3, devops-engineer, 0.5h, backlog) — when any new file is
  added to `apps/decision-api/src/lib/` that mirrors logic in `packages/shared` or
  `apps/control-plane/src/`, MUST add a manifest entry in the same PR. Encode as a Rule J amendment
  "any new file in this dir requires a manifest decision" — bundle into Rule J documentation.
- **TG-5 — No test asserts `seedListingEmbeddingsForActivation` is idempotent on re-activation.** PR
  #132 documents idempotency via upsert semantics, but the test set doesn't include "activate twice
  → embed each listing once OR twice depending on what we want; assert the behavior." Currently
  re-activating a tenant fires the seed twice (it's fire-and-forget; the schema activate route does
  NOT check whether seeding already happened). Cost: 2× OpenAI calls per re-activation for the demo
  tenant (12 listings × 2 = 24 calls), $0.001 total — negligible. But the test gap is real. Severity
  **P3**. **No new FOLLOW** — defer.

#### 4d. Documentation gaps

- **DG-1 — `feedbackConvertedFalse` and `feedbackEvents` SDK config options are NOT documented in
  Master Design §B.1 (SDK config surface).** The SDK code has JSDoc, but the canonical operator-
  facing doc is Master Design. Same shape as FOLLOW-060 (which already covers the new
  `/api/adapt/feedback` and `/api/listings/embed` endpoints). → fold into FOLLOW-060 AC OR new
  **FOLLOW-071** (P2, architect, 0.5h, Sprint 11) — document SDK feedback config options in §B.1.
- **DG-2 — `DEMO_LISTING_MANIFEST` is hardcoded in `seed-listing-embeddings.ts` (12 entries) but no
  doc explains the relationship between this manifest, the `000-app-estalara` corpus fixture, and
  `data-estalara-listing-id` attributes on the demo page.** A future contributor adding a 13th demo
  listing must edit the manifest AND the fixture AND the demo page AND the corpus expected output.
  Three of those four are co-located; the manifest is in a fourth location. → **FOLLOW-072** (P3,
  architect + data-engineer, 0.5h, backlog) — add a `docs/DEMO_TENANT.md` (or §T section) that
  explains the multi-file demo-tenant data contract.
- **DG-3 — `INTERNAL_API_SECRET` is referenced in `.env.example` and used as a service-to-service
  auth header by `seed-listing-embeddings.ts`, but no threat model documents its scope.** PR #133
  added a Master Design §V.3.2 entry for the HMAC; the _internal_ shared secret used to bridge
  control-plane → embed-endpoint is undocumented. If `INTERNAL_API_SECRET` leaks, an attacker can
  poison embeddings for any tenant. Severity **P2** because this is a server-to-server secret that
  only lives in Doppler. → **FOLLOW-073** (P2, compliance-engineer, 1h, Sprint 11) — Master Design
  §V.3.3 threat model for `INTERNAL_API_SECRET`; key rotation runbook.
- **DG-4 — `pnpm seed:archetypes` and `pnpm seed:listings` are not mentioned in the root README or
  any onboarding doc.** A new developer pulling `main` will be silently broken: cosine path will
  degrade to djb2, the dashboard will show "0% variant lift" everywhere, and there is no diagnostic.
  → **FOLLOW-074** (P2, architect, 0.5h, Sprint 11) — add a "Local development setup" README section
  listing required one-shot seeds and Doppler keys. Bundle with FOLLOW-063 (LG-1).

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- N/A — Sprint 10 is the last sprint in the window. All 9 planned tickets DONE.

#### 5b. Future sprint tickets affected

- **Sprint 11 (Pilot onboarding + docs + launch checklist) — TBD scope:** RETRO-006 surfaces 12 new
  FOLLOW-UPs (062–074). The most pilot-blocking are FOLLOW-063 (P1, auto-seed enforcement),
  FOLLOW-068 (P1, demo CI integration), FOLLOW-069 (P1, HMAC compatibility test). All three should
  land in Sprint 11 before any pilot tenant is provisioned.
- **FOLLOW-039 (Sprint 11, P0 — ClickHouse DSR hard-delete):** Still deferred. No EU pilot in 4-6
  weeks. RETRO-006 confirms no change to this assumption.
- **TICKET-NATIVE-001 (BLOCKED):** No direct Sprint 10 impact. The SDK changes in #127/#133 do not
  affect SvelteKit integration patterns. But LG-2 (`_feedbackListenerRegistered` module singleton)
  may surface when Native shipping double-loads the SDK — note in the NATIVE-001 spec when it
  unblocks.
- **TICKET-CAUSAL-001 (BACKLOG, P2 — CATE estimation):** Now mostly unblocked. Sprint 10 closed the
  feedback loop — once enough conversion data lands in `ab_bandit_weights`, CATE math has real
  input. Add a note that CAUSAL-001 should also wait until `archetype_embeddings.embedding` is
  non-NULL (LG-1) so the treatment dimension is meaningful.
- **FOLLOW-040 (parallel Doppler CI hygiene):** Still incomplete. FOLLOW-043's six fix-commits are
  exactly the kind of friction FOLLOW-040 was supposed to eliminate. Promote priority.

#### 5c. Contracts changed that other modules rely on

- **`AdaptResponse.variant?: string`** — every SDK consumer (today: `index.ts:apply()`) reads the
  field via TypeScript optional access. No downstream break. Native (BLOCKED) will need to honor it
  when unblocking.
- **`POST /api/adapt/feedback` auth scheme change (Bearer → HMAC)** — only the SDK calls this
  endpoint; SDK was updated in same PR #133. No external integrators today. **If any future
  third-party integrator emerges, the auth pivot must be in the integration docs.** → folded into
  FOLLOW-060 / FOLLOW-071.
- **`ErrorCode.STAFF_TENANT_CONTEXT_MISSING`** — additive; no breakage.
- **`MIRROR_FILES` manifest** — new contract; only affects DEVOPS workflows.

#### 5d. Architectural assumptions affected

- **Master Design §V.3 — Security architecture: feedback endpoint threat model.** PR #133 added
  §V.3.2. The decision (HMAC over body, tenant API key as secret, accept ops `ADAPT_API_KEY`
  fallback, no replay protection) is now codified. Single doc-as-truth resolution.
- **Master Design §F — Data Network Effect (archetype embedding space).** The Sprint 9.5 Snapshot.1
  edit M-4 noted "cosine path is unreachable in production today; FOLLOW-019's headline claim is
  functionally a no-op until the archetype embedding vectors are computed." Sprint 10's PR #131 + 6
  fix commits _technically_ satisfies FOLLOW-043, but **LG-1 above flags that the production DB is
  still NOT seeded automatically.** The Snapshot.1 row F language ("cosine path is unreachable")
  remains true for any dev-environment pull of `main` until an operator runs the manual
  `workflow_dispatch`. The Snapshot.1 verdict needs nuance — see §7 below.
- **Master Design §E.3 — A/B + bandit.** The Sprint 9.5 Snapshot.1 row E.1–E.3 (M-3) flagged two
  half-wires: FOLLOW-041 (SDK feedback ping) and FOLLOW-042 (SDK variant consumer). Both CLOSED this
  sprint. Snapshot.1 row E.1–E.3 needs updating — see §7.
- **Master Design §B.4 — Auto-Onboarding UI.** RETRO-005 Edit M-1 listed three open gaps: (a)
  Magic-Link email flow, (b) listing embedding auto-seed, (c) end-to-end integration test. Sprint 10
  partially closes (b) — auto-seed exists but ONLY for the demo tenant (per §3 + LG-1). (c) is
  shipped as a _guarded test_ not yet running in CI (per TG-1). (a) Magic-Link email is still
  BLOCKED. Snapshot.1 row B.4 needs updating to reflect partial closure of (b) and (c) — see §7.
- **Operating Principles §Y.3 — Snapshot.1 re-verification.** PR #134 (FOLLOW-061) added the process
  gate. **Sprint 10 IS the first sprint that must follow this rule on close.** This very retro is
  the first execution of the rule. See §7.

### 6. New lesson candidates

- **Pattern A: "Ship a feature with relaxed auth, harden auth in the next PR" (16h regression
  window).** Seen RETRO-002 (FIX-013..019), RETRO-005 (FOLLOW-051 surfaced), RETRO-006 LG-3 (PR #127
  → PR #133). Count: **3 retros, 3+ instances.** **Threshold MET.** But this is structurally a
  sub-case of Rule H ("scaffold shipped without runtime wiring") applied to the _auth surface_
  rather than the _consumer surface_. Recommend **AMENDING Rule H** rather than promoting Rule K.
  Specifically: amend Rule H §1 to read "...new symbol AND any new authenticated mutation endpoint
  MUST land with its production auth surface (not a permissive dev fallback) wired in the same PR."
  See proposed amendment text in §6a below.
- **Pattern B: "Operational seed script ships but environment plumbing breaks; needs N fix
  commits."** Seen RETRO-005 (PR #125 CI billing — 1 instance), RETRO-006 (PR #131 FOLLOW-043 — 6
  fix commits). Count: **2 retros, 2 instances.** **Threshold MET as a class.** Distinct from Rule H
  (which is about wiring within the codebase). This is about wiring between the codebase and the
  _deployment environment_ (Doppler config, build artifacts, secrets, IPv6 reachability). Not yet a
  clean Rule candidate — the symptom is "operator-runnable scripts merge green without an
  environment smoke check." Track. Promote when next instance occurs. Possibly worth a
  forward-looking ADR or §V section on "operator-runnable scripts must include an environment-
  preflight assertion in CI." Recommend deferred to RETRO-007.
- **Pattern C: "Test exists but is opt-in behind an environment flag that CI never sets" (PR #130
  E2E spec).** Seen RETRO-006 only. Count: **1 retro, 1 instance.** **Threshold NOT YET met.**
  Track. If FOLLOW-068 closes by Sprint 11 close, this pattern dissolves naturally. If a second
  ticket ships a "test exists but doesn't run" surface, promote to a Rule.
- **Pattern D: Rule H closure velocity.** Sprint 10 is the FIRST sprint that ended with **fewer open
  half-wires than it started with**. RETRO-005 left 4 open P0/P1 half-wires; Sprint 10 closed all 4
  and opened 1 P3. This is a positive signal — the learning loop is producing the intended asymmetry
  (more findings closed than newly opened in steady state). **Not a rule promotion but a
  process-health metric** worth tracking explicitly in future sprint rollups.

#### 6a. Proposed Rule H amendment (deferred to architect approval)

Amend Rule H Pattern paragraph to add:

> Also covered: a PR that introduces a new authenticated mutation endpoint MUST land with its
> production auth surface (not a permissive dev fallback) wired in the same PR. Shipping a mutation
> endpoint with `if (!process.env.PROD_KEY) accept_any_bearer` and ratcheting auth in a follow-up PR
> creates a regression window between merge times. RETRO-006 LG-3 documents a 16-hour window where
> `POST /api/adapt/feedback` accepted unsigned Bearer tokens. The fix: land HMAC (or equivalent
> production-grade auth) in the _same_ PR that ships the endpoint or its consumer.

This amendment **DOES NOT promote a new Rule** — threshold is met as a sub-pattern of Rule H, not as
a discrete class. PM/architect decides whether to apply at next governance pass.

### 7. Master Design updates

**Verdict: YES, an update IS warranted.** Operating Principles §Y.3 (codified by PR #134) requires
Snapshot.1 re-verification at sprint close. This is the first execution of that obligation. Three
rows are stale relative to current `HEAD` (`c596821`):

**Edit M-7 — §Snapshot.1 row B.4 (Auto-Onboarding UI):**

Partial closure of the three Sprint 9.5 open gaps:

- Gap (a) Magic-Link email flow — still BLOCKED (TICKET-040). No change.
- Gap (b) Listing embedding auto-seed — Sprint 10 PR #132 closed for the demo tenant
  (`DEMO_LISTING_MANIFEST` 12 entries). For non-demo tenants, the helper requires
  `schema.listing_ids` from the activated schema, which the wizard does not yet populate.
  **Partially closed.**
- Gap (c) End-to-end integration test — Sprint 10 PR #130 added the spec but it's guarded behind
  `NEXT_PUBLIC_TEST_E2E=true` and CI never sets the flag. Static contract tests DO run. **Partially
  closed.**

**Edit M-8 — §Snapshot.1 row E.1–E.3 (Adaptation decision tree + A/B + bandit):**

Both half-wires from Sprint 9.5 are closed:

- FOLLOW-041 (SDK feedback ping) — DONE via PR #127.
- FOLLOW-042 (SDK variant consumer) — DONE via PR #127.

Add: FOLLOW-051 hardened the feedback auth to HMAC (PR #133). Bandit feedback loop is now end-to-end
wired, but `archetype_embeddings.embedding` NULL state (Snapshot.1 row F) means the variant
_selection_ is still keyed against the seeded `ab_bandit_weights` rows and not against embedded
archetype context. Verdict can move from 🟡 Partial → 🟡 Partial (no upgrade) with specific note
that the _bandit feedback loop is closed but the embedding-conditioned bandit selection awaits LG-1
closure_.

**Edit M-9 — §Snapshot.1 row F (Data Network Effect):**

Update the row to reflect that the seed script exists but is not yet automatically run:

- Old (RETRO-005 M-4 state): cosine path unreachable; FOLLOW-043 tracks.
- New: FOLLOW-043 (PR #131 + 6 fix commits) ships a `pnpm seed:archetypes` script + manual
  `workflow_dispatch`. The script CAN populate archetype vectors when invoked against a Doppler-
  configured environment with `SUPABASE_SERVICE_ROLE_KEY` + `OPENAI_API_KEY`. **No CI step or
  on-merge automation runs the seed.** For any fresh DB pull, `archetype_embeddings.embedding`
  remains NULL until an operator runs the workflow. Status remains 🟡 Partial with a precise caveat
  tracked in FOLLOW-063.

**Edit M-10 — §Snapshot.1 row V.1 (Security Architecture, V.3.2 already added by PR #133):**

The Sprint 9.5 retro left §V.1 as 🟡 Partial. PR #133 added the §V.3.2 threat model for the feedback
endpoint. The verdict on V.1 should be unchanged (still 🟡 Partial — broader security debts remain),
but the row reason text should mention V.3.2.

**Edit M-11 — Add a Sprint 10 close prose update at the bottom of the existing Snapshot.1 "Updates"
block:**

`**Update 2026-05-24 (Sprint 10 close — RETRO-006):** Sprint 10 COMPLETE — 8 PRs merged (#127, #128, #129, #130, #131, #132, #133, #134). Closed all 4 P0/P1 half-wires from RETRO-005 (SDK variant + feedback ping, archetype embedding seed, listing embedding auto-seed for demo tenant). Hardened feedback endpoint to HMAC-SHA256 (PR #133, FOLLOW-051). Rule J mirror-code CI gate live (PR #128). Sprint-close Snapshot.1 re-verification is now mandatory (PR #134, OP §Y.3). **Open gaps surfaced by RETRO-006:** FOLLOW-063 (no automated archetype-embedding seeding outside manual workflow_dispatch — cosine path remains unreachable on any fresh DB pull); FOLLOW-068 (E2E integration test merged but CI does not run it); FOLLOW-069 (no HMAC SDK↔server compatibility test). Per OP §Y.3 the next Snapshot.1 re-verification is at Sprint 11 completion.`

**Apply edits inline below in §8.**

#### 7a. Master Design version bump

Bump `**Wersja:** 2.2` →
`**Wersja:** 2.3 (Sprint 10 close — RETRO-006 reconciliation; bandit feedback loop closed; HMAC hardening; mirror-code CI live)`.
Add changelog v2.3 entry at the top listing M-7..M-11.

### 8. Edits applied

This retrospective directly modifies `docs/MASTER_DESIGN.md` per Edits M-7 through M-11 specified in
§7. Applied 2026-05-24 by retrospective-analyst. The local working tree on branch
`architect/FOLLOW-061-snapshot-checklist` lags `origin/main` by two commits (#133, #134); the edits
are written against the local v2.1 master (which is structurally equivalent to v2.2 modulo the
§V.3.2 add). When this branch merges and rebases, the v2.3 bump applies on top of the v2.2 base.

### 9. Follow-ups

- FOLLOW-062: Document `feedbackConvertedFalse` SDK operator surface OR remove the field
  (sdk-engineer + architect, 0.5h, P3, backlog)
- FOLLOW-063: CI precheck + README + auto-seed for `archetype_embeddings.embedding` NOT NULL
  invariant (devops-engineer + ml-engineer, 2h, P1, Sprint 11) — **blocks any pilot**
- FOLLOW-064: Refactor `_feedbackListenerRegistered` from module singleton to per-instance
  (sdk-engineer, 1h, P2, backlog) — needed before TICKET-NATIVE-001
- FOLLOW-065: Emit `events.feedback.send_failed` on SDK ping 4xx/5xx + dashboard panel
  (sdk-engineer + backend-engineer, 1.5h, P2, Sprint 11)
- FOLLOW-066: Tighten `FeedbackBodySchema.tenant_id` to UUID/slug regex (backend-engineer, 0.5h, P3,
  backlog)
- FOLLOW-067: E2E spec `beforeAll()` precheck for `E2E_BEARER_TOKEN` (qa-engineer, 0.25h, P3,
  backlog)
- FOLLOW-068: Provision `demo-integration` CI job that runs the E2E spec end-to-end (qa-engineer +
  devops-engineer, 4h, P1, Sprint 11) — **blocks pilot demo confidence**
- FOLLOW-069: Cross-runtime HMAC compatibility test SDK↔server + regression test for
  presence-only-Bearer rejection (qa-engineer + backend-engineer, 2h, P1, Sprint 11) — **closes LG-3
  regression risk**
- FOLLOW-070: Rule J amendment — extend manifest discipline to any new file in
  `apps/decision-api/src/lib/` (devops-engineer, 0.5h, P3, backlog)
- FOLLOW-071: Document SDK feedback config options (`feedbackEvents`, `feedbackUrl`,
  `feedbackConvertedFalse`) in Master Design §B.1 — fold into FOLLOW-060 (architect, 0.5h, P2,
  Sprint 11)
- FOLLOW-072: Add `docs/DEMO_TENANT.md` explaining the multi-file demo-tenant data contract
  (architect + data-engineer, 0.5h, P3, backlog)
- FOLLOW-073: Master Design §V.3.3 threat model for `INTERNAL_API_SECRET` + key rotation runbook
  (compliance-engineer, 1h, P2, Sprint 11)
- FOLLOW-074: README "Local development setup" with required Doppler keys + seed scripts (architect,
  0.5h, P2, Sprint 11) — fold with FOLLOW-063 + FOLLOW-040

### 10. Cross-references

- **RETRO-005 (Sprint 9.5):** This retro is the direct closure pass for 4 of the 5 RETRO-005 §3
  HALF*WIRE findings (FOLLOW-041, -042, -043 = LG-1 partial only, -046 = demo-only). The 5th
  (FOLLOW-055 e2e test) is \_shipped* but _not running in CI_ (TG-1). RETRO-005 successfully
  predicted the half-wire surfaces; Sprint 10 successfully prioritized closure. The retro loop is
  functioning as intended.
- **RETRO-002 (TICKET-AB-001) + RETRO-003 (TICKET-REORDER-001):** Rule H originally codified here.
  RETRO-006 records the SIXTH consecutive retro where Rule H is the dominant pattern AND the first
  retro that shows net closure (more half-wires closed than opened). Rule H is stable; the proposed
  amendment in §6a is non-urgent.
- **RETRO-004 (TICKET-046 deep re-analysis):** Identified the doc-as-spec divergence sub-pattern.
  RETRO-006 confirms this — DG-1 (feedback config options in code but not in Master Design) and DG-3
  (`INTERNAL_API_SECRET` undocumented threat model) are exactly that shape.
- **CONVENTIONS_PATCH.md Rule A (Verify CI green before READY_FOR_REVIEW):** Held for all 8 Sprint
  10 PRs. The PR #125 incident from Sprint 9.5 did NOT recur.
- **CONVENTIONS_PATCH.md Rule H (Schema scaffold MUST ship with at least one runtime-wired
  consumer):** Held for 7 of 8 PRs. The one exception (FOLLOW-062 — `feedbackConvertedFalse` config
  field with no operator surface) is P3 and acceptable as a flag for future surfaces.
- **CONVENTIONS_PATCH.md Rule I (Wired-or-dead):** Held. Sprint 10 reduced legacy dead-symbol count
  by FOLLOW-007 wiring; no new dead symbols introduced.
- **CONVENTIONS_PATCH.md Rule J (Mirror-Code Sync Gate):** Live as of PR #128. First sprint with
  active enforcement. Caught zero violations during sprint (no mirrored files were edited).
- **Operating Principles §Y.3 (Snapshot.1 re-verification at sprint close):** RETRO-006 IS the first
  execution. §7 above performs the verification; §8 applies the edits.

---

## RETRO-007 — Sprint 11 (Pilot readiness — seed CI, demo CI, HMAC compat, ClickHouse DSR, Doppler) — 2026-05-24

**Scope:** Sprint-level retrospective bundling 5 merged PRs (#135, #136, #137, #138, #139). Sprint 11
was the "pilot readiness" sprint — the explicit goal in QUEUE.md preamble was to close all 5 P1
pilot-blockers (3 RETRO-006 P1 carry-overs FOLLOW-063 / FOLLOW-068 / FOLLOW-069, the EU pilot gate
FOLLOW-039, and the Doppler ops hygiene FOLLOW-040) so that no further engineering work stands
between today and the first pilot tenant. All 5 P1 tickets shipped. The 4 P2 quality items
(FOLLOW-065 / FOLLOW-071 / FOLLOW-073 / FOLLOW-074) remain READY for Sprint 12 promotion.

This retro is the **second execution** of Operating Principles §Y.3 (Snapshot.1 re-verification at
sprint close, codified by PR #134 / FOLLOW-061 at end of Sprint 10).

### Sprint-level rollup

| Metric                            | Value                                                                  |
| --------------------------------- | ---------------------------------------------------------------------- |
| Sprint goal                       | Close all P1 pilot-blockers (seed CI / demo CI / HMAC compat / EU GDPR / Doppler) |
| PRs merged                        | 5 (#135 → #139)                                                        |
| Ticket completion                 | 5/5 P1 IN_PROGRESS tickets DONE; 4/4 P2 tickets remain READY           |
| Tickets DEFERRED                  | 0 (FOLLOW-065/071/073/074 remain in Sprint 11 READY for Sprint 12)     |
| Estimated → actual hours          | 15h planned (3+2+4+1+5); modest overshoot from gitleaks/prettier fixes |
| CI green on first push            | 3/5 (PR #136 needed gitleaks/prettierignore fixes; PR #137 needed soft-skip fix) |
| Files changed (sprint cumulative) | 36 (across 5 PRs; +2,773 / -66)                                        |
| New routes                        | 1 (`/api/dsr/mutation-poll` Vercel Cron, FOLLOW-039)                   |
| New CI jobs                       | 3 (`archetype-embeddings-not-null` in ci.yml; `post-migrate-seed`; `demo-integration`) |
| New permanent Rules               | 0 (Rule H amendment already promoted to CONVENTIONS_PATCH.md in Sprint 10) |
| New ADRs                          | 0                                                                      |
| Master_Design version             | v2.3 → v2.4 (FOLLOW-039 added §H.1.1 + row H closure)                  |
| Repeating retros' pattern hit     | Rule H — 7 retros in a row; first sprint where Rule H is in net positive (closing > opening) |

**Velocity vs plan:** Sprint 11 hit its plan on the wire-up tickets. PR #135 (FOLLOW-063) and PR
#137 (FOLLOW-068) both required additional post-merge fix commits because gitleaks false positives
on test fixtures and prettier formatting on the agent-managed `RETROSPECTIVES.md` broke CI in ways
that were not in the original ticket scope. The .prettierignore exemption for `RETROSPECTIVES.md`
and the gitleaks allowlist for cross-runtime HMAC test fixtures became necessary infrastructure (see
§4d DG-1). The commitlint regex was widened in PR #135 to accept `[FOLLOW-NNN]` commit subjects
(retroactive fix for a long-standing issue that was silently rejecting every Sprint 8+ retro-loop
commit).

**Six new infrastructure surfaces shipped this sprint:**

1. `archetype-embeddings-not-null` CI job (push:main only, soft-skip until DOPPLER_TOKEN_DEV
   provisioned) — `.github/workflows/ci.yml:280` (LG-1 from RETRO-006 closed structurally).
2. `post-migrate-seed.yml` workflow (idempotent `pnpm seed:archetypes` on push:main) — fully
   eliminates the manual `workflow_dispatch` operator burden once FOLLOW-040 provisions the secret.
3. `demo-integration.yml` workflow with `NEXT_PUBLIC_TEST_E2E=true` injection — runs FOLLOW-055's
   E2E spec against a live Next.js server (FOLLOW-068 / TG-1 from RETRO-006 closed structurally).
4. `packages/shared/src/__tests__/cross-runtime/hmac-feedback.test.ts` — 12 fixture pairs assert
   byte-identical hex digests across Web Crypto (`crypto.subtle.sign`) and Node `createHmac`
   (FOLLOW-069 / TG-2 + TG-3 from RETRO-006 closed).
5. ClickHouse DSR hard-delete pipeline — `apps/control-plane/src/lib/clickhouse-dsr.ts` (367 LOC,
   SQL builder + poll/retry helpers), `/api/dsr/mutation-poll` Vercel Cron (every 5 min),
   `dsr_clickhouse_mutations` operational Postgres table (Drizzle migration 0014), audit-log
   columns on `dsr_audit_log` (ClickHouse migration 0011).
6. Doppler CI hygiene — `dopplerhq/cli-action@v3` install + soft-degradation in `doppler-verify`
   job; Master Design §V.6.1 token scoping table added.

**Repeating patterns across the 5 PRs:**

1. **Rule H closure velocity** — Sprint 11 is the **second** consecutive sprint where the retro
   loop closed more half-wires than it opened. RETRO-006 left 3 P1 half-wires (LG-1 archetype seed
   automation, TG-1 E2E in CI, TG-2 HMAC compat). All 3 are now structurally closed at the CI/code
   layer — though three of them only "fully activate" once `DOPPLER_TOKEN_DEV` is provisioned in
   GitHub Actions secrets (ESC-009 carry-forward of FOLLOW-040, see §3).
2. **Soft-skip-on-missing-secret as a default pattern.** PR #135, PR #137, PR #138 all added jobs
   that soft-skip when `DOPPLER_TOKEN_DEV` is absent. This makes them mergeable without unblocking
   the secret first (which would itself escalate to Piotr). Once the secret lands, all three jobs
   activate automatically. This is a structurally sound pattern that should be codified — it is a
   variant of the Rule C "verify repo config before opening PR" rule, with the new wrinkle "but
   ship structurally so the moment config lands, code activates without redeployment."
3. **Test-fixture gitleaks false positives.** PR #136 shipped `pk_live_` / `pk_test_` prefixed
   test fixture keys; gitleaks flagged them as generic-api-key matches. Fix commit `9ca058e`
   renamed to `tenant_api_key_` / `tenant_test_key_` and added an allowlist. The first instance of
   this class of false positive in the retro corpus; track but not yet Rule-worthy.
4. **`RETROSPECTIVES.md` formatting friction.** Three separate fix commits during Sprint 11 ran
   `prettier --write` against `backlog/RETROSPECTIVES.md` to chase CI format check failures. The
   agent-generated retro content has intentional long lines (table cells, inline code spans,
   quoted file paths) that prettier cannot wrap cleanly. PR #136 finally added the
   `.prettierignore` exemption, matching the existing pattern for `docs/MASTER_DESIGN.md`. The
   `.gitleaks.toml` also gained 2 lines of allowlist.

### 1. Summary of change

| PR   | Ticket     | Title                                                                  | Files | +/−          | Merged                       |
| ---- | ---------- | ---------------------------------------------------------------------- | ----- | ------------ | ---------------------------- |
| #135 | FOLLOW-063 | Auto-seed archetype_embeddings + NOT NULL precheck                     | 6     | +211 / −8    | 2026-05-24 14:25Z, `4ee378f` |
| #136 | FOLLOW-069 | Cross-runtime HMAC compat + Bearer-only LG-3 regression guard          | 5     | +296 / −1    | 2026-05-24 14:53Z, `3d2d093` |
| #137 | FOLLOW-068 | `demo-integration` CI job runs detect→activate→adapt E2E               | 6     | +274 / −9    | 2026-05-24 14:53Z, `43aff9d` |
| #138 | FOLLOW-040 | Doppler service token + `doppler run` wrapper in workflows             | 6     | +153 / −18   | 2026-05-24 14:25Z, `a0c55c0` |
| #139 | FOLLOW-039 | ClickHouse DSR hard-delete — Art. 17 erasure (EU pilot gate cleared)   | 16    | +1839 / −30  | 2026-05-24 14:54Z, `7af88dd` |

**Cumulative:** 36 files changed, +2,773 / −66 across the sprint (plus ~10 additional fix commits
on `main` for prettier/gitleaks/soft-skip refinements).

**Per-PR one-sentence summaries:**

- **PR #135 (FOLLOW-063):** Adds `archetype-embeddings-not-null` CI job (`.github/workflows/ci.yml:280`)
  + `.github/workflows/post-migrate-seed.yml` (idempotent `pnpm seed:archetypes` on push:main) +
  README "Local development setup" section + commitlint regex widened to accept `[FOLLOW-NNN]`
  commit subjects. Both new jobs use the soft-skip-on-missing-secret pattern.
- **PR #136 (FOLLOW-069):** Adds `packages/shared/src/__tests__/cross-runtime/hmac-feedback.test.ts`
  (270 LOC, 12 fixture pairs covering ASCII, UTF-8 Polish/Arabic, empty body, 10KB body, newlines,
  special-char keys, UUID keys) asserting Web Crypto ≡ Node `createHmac`. Adds LG-3 regression
  guard in `feedback/route.test.ts` (presence-only Bearer → 401). HMAC helpers are inlined as
  independent oracle (Rule J strategy 3 — snapshot-tested).
- **PR #137 (FOLLOW-068):** Adds `.github/workflows/demo-integration.yml` (200 LOC) bringing up
  Next.js with `NEXT_PUBLIC_TEST_E2E=true` and running `tests/e2e/sprint-9-5-demo.spec.ts`. Adds
  `beforeAll()` `E2E_BEARER_TOKEN` precheck in the spec (bundles FOLLOW-067). Files ESC-009
  requesting `E2E_BEARER_TOKEN` + `E2E_TENANT_ID` provisioning.
- **PR #138 (FOLLOW-040):** Rewrites `doppler-verify` job with `dopplerhq/cli-action@v3` install +
  soft-degradation. Documents §V.6.1 token scoping (dev token in GitHub Actions secrets;
  production = Vercel-only). Files an ESCALATION for `DOPPLER_TOKEN_DEV` provisioning (note: this
  ESCALATION is the **same root** as ESC-009 but a distinct entry — see §3).
- **PR #139 (FOLLOW-039):** Implements RODO Art. 17 erasure against ClickHouse.
  `apps/control-plane/src/lib/clickhouse-dsr.ts` (367 LOC) provides SQL builder + poll + retry
  helpers; `/api/dsr/mutation-poll` Vercel Cron (every 5 min, registered in `vercel.json:7`) polls
  `system.mutations` for completion; `dsr_clickhouse_mutations` Postgres table (Drizzle migration
  0014) tracks operational state with status enum (`pending`/`in_progress`/`done`/`failed`) +
  retry_count + next_retry_at + alter_sql + lastFailedReason. Bumps Master Design v2.3 → v2.4 and
  adds §H.1.1 documenting realistic erasure semantics; DPIA v2.0 → v2.1.

**Key contracts changed:**

- `commitlint.config.cjs` regex — CHANGED to accept `[FOLLOW-\d+]` ticket prefix (PR #135, line
  108) — breaking: no (additive). Retro-loop commits previously rejected since Sprint 8 now pass.
- `.prettierignore` — ADDED `backlog/RETROSPECTIVES.md` (post-merge fix `9ca058e`) — breaking: no
  (formatting exemption only).
- `.gitleaks.toml` — ADDED 2-line allowlist for cross-runtime HMAC test fixtures (PR #136 +
  follow-up `318c9fa`).
- `POST /api/dsr/erase` response shape — CHANGED to include
  `clickhouse_mutation_ids: Record<string, string>` and `status: 'pending' | 'done' | 'failed'` —
  breaking: yes for any caller asserting on response shape; no real callers exist yet.
- `vercel.json` — ADDED `crons: [{ path: '/api/dsr/mutation-poll', schedule: '*/5 * * * *' }]` —
  breaking: no (additive); requires Vercel Pro plan.
- `dsr_audit_log` ClickHouse columns — ADDED `clickhouse_mutation_id`,
  `clickhouse_mutation_status`, `clickhouse_mutation_completed_at` (migration 0011) — breaking: no
  (additive with defaults).
- `dsr_clickhouse_mutations` Postgres table — NEW (migration 0014, RLS enabled service-role-only)
  — breaking: no (new table).
- `ErrorCode.STAFF_TENANT_CONTEXT_MISSING` already added in Sprint 10 PR #129 — used by PR #139's
  mutation-poll route but not added new in Sprint 11.

### 2. Verification in PRs

- Test files added/changed: 4 across the sprint (cross-runtime HMAC suite 270 LOC; LG-3 regression
  guard +16 LOC; clickhouse-dsr unit suite 175 LOC; erase route integration suite 278 LOC; dsr-routes
  test +21 LOC; e2e spec precheck +18 LOC).
- New assertions: ~80 (12 cross-runtime HMAC pairs × multiple invariants; 21 clickhouse-dsr
  builder/aggregation/inventory tests; 28+ erase-route integration tests; 1 LG-3 regression guard;
  E2E precheck).
- Coverage delta: control-plane 516 → 541 tests (PR #139 final count, +25 net); shared package
  gained the cross-runtime workspace (new subdir).
- CI checks: **All 5 PRs landed with green TypeScript/JS lanes** at merge time. Pre-existing
  baseline failures (`Doppler verify` soft-skip, `Rule I` legacy dead code count, 7× Python tests,
  occasional Vercel Preview rate limit) continued to recur and are explicitly ignored per QUEUE.md
  Sprint 11 preamble.
- Rule A held for all 5 PRs (no PR #125-style billing-blocked merge).
- Rule H closure: 7 retros in a row dominated by Rule H pattern, but Sprint 11 was a NET CLOSURE
  sprint — 3 P1 RETRO-006 half-wires closed structurally; 0 new HALF_WIRE findings.

**NOT verified by tests (load-bearing gaps — see §4c):**

- **The new CI jobs (`archetype-embeddings-not-null`, `post-migrate-seed`, `demo-integration`)
  cannot actually run end-to-end until `DOPPLER_TOKEN_DEV` is provisioned (ESC-009 / FOLLOW-040
  carry-over).** All three exist in the workflow files, all three soft-skip cleanly, all three
  will activate the moment Piotr adds the secret. But until then, the protection is
  "structurally present" rather than "operationally enforced."
- **`/api/dsr/mutation-poll` Vercel Cron is registered in `vercel.json` but no integration test
  exercises the full poll → status-update → retry-on-failure → terminal-failure-Sentry flow
  against a real ClickHouse instance.** Unit tests cover SQL builder, aggregation precedence,
  backoff schedule. Real-mutation behaviour against ClickHouse Cloud is unverified.
- **ESC-009 (E2E_BEARER_TOKEN provisioning) is filed but unresolved.** Even after FOLLOW-040
  unblocks `DOPPLER_TOKEN_DEV`, the `demo-integration` job has an inner gate (`beforeAll()`
  precheck) that requires `E2E_BEARER_TOKEN`. The E2E steps will continue to soft-skip until
  ESC-009 is resolved.

### 3. Wiring Audit

This sprint introduces minimal new surface (one new route `/api/dsr/mutation-poll`, one new
library `apps/control-plane/src/lib/clickhouse-dsr.ts`, one new DB table `dsr_clickhouse_mutations`,
three new CI jobs, one new SDK test fixture). All are wired in the same PR.

**CHECK A — Dead code detection:**

Each new exported file in the 5 PRs was grepped for non-test importers:

- `apps/control-plane/src/lib/clickhouse-dsr.ts` — `DSR_CLICKHOUSE_TABLES`,
  `buildDeleteWhereSession`, `aggregateMutationStatus`, `computeNextRetryAt`, `pollMutationStatus`,
  etc. — all consumed by `apps/control-plane/src/app/api/dsr/erase/route.ts:42-45` AND
  `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts`. **Clean.** (verified via
  `grep -rn clickhouse-dsr apps/` — 9 production matches outside the module itself).
- `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts` — Vercel Cron entrypoint (Next.js
  file-based route, framework-discovered + registered in `vercel.json:7`). **Clean.**
- `apps/control-plane/src/app/api/dsr/mutation-poll/_finalise.ts` — internal helper, imported by
  `mutation-poll/route.ts` (verified via grep). **Clean.**
- `packages/db/src/schema/dsr_clickhouse_mutations.ts` — Drizzle schema; consumed by
  `packages/db/src/schema/index.ts:1` (added in PR #139) + by `clickhouse-dsr.ts` + by
  `mutation-poll/route.ts`. **Clean.**
- `packages/shared/src/__tests__/cross-runtime/hmac-feedback.test.ts` — vitest test file,
  framework-discovered. **Clean** (test file pattern; not expected to have importers).
- `.github/workflows/post-migrate-seed.yml` and `.github/workflows/demo-integration.yml` — CI
  workflow files, framework-discovered by GitHub Actions. **Clean.**

No DEAD_CODE candidates this sprint.

**CHECK B — Half-wire detection:**

New events / env vars / DB columns / runtime signals introduced:

- **Env var `DOPPLER_TOKEN_DEV`** — consumer: 4 workflow files (`ci.yml` doppler-verify + new
  archetype-embeddings-not-null; `post-migrate-seed.yml`; `demo-integration.yml`;
  `seed-archetypes.yml` already existed). Producer: **MISSING from GitHub Actions secrets**
  (ESC-009 / FOLLOW-040 escalation explicitly says "token has NOT been created yet"). HALF_WIRE_C
  by the formal definition: consumer code present, producer (the secret in repo settings) not
  provisioned. **However**, the consumer side is deliberately wired with soft-skip semantics, so
  no runtime break occurs — it is a HALF_WIRE_C BY DESIGN (waiting on a manual Piotr action,
  not on engineering work). Priority **P1** for the moment FOLLOW-063/068/039 jobs need to
  actually enforce in CI. → already tracked by ESC-009 + the existing FOLLOW-040 escalation, no
  new FOLLOW.
- **Env var `E2E_BEARER_TOKEN`** — consumer: `tests/e2e/sprint-9-5-demo.spec.ts:35` +
  `beforeAll()` precheck at line ~50. Producer: **MISSING from GitHub Actions secrets**
  (ESC-009 explicitly requests it). HALF_WIRE_C by the formal definition; deliberately wired with
  fail-fast precheck so the failure mode is actionable rather than silent. → already tracked by
  ESC-009, no new FOLLOW.
- **GitHub Actions variable `E2E_TENANT_ID`** — consumer: `demo-integration.yml` reads
  `${{ vars.E2E_TENANT_ID }}`. Producer: **MISSING from GitHub Actions variables** (ESC-009
  requests). Same shape as above. → already tracked by ESC-009.
- **DB column `dsr_clickhouse_mutations.status`** — producer: `clickhouse-dsr.ts` insertion path
  on every `POST /api/dsr/erase` call; consumer: `mutation-poll/route.ts` reads to drive
  ClickHouse polling + status transitions. ✅ Both ends shipped same PR.
- **DB column `dsr_audit_log.clickhouse_mutation_status` (ClickHouse)** — producer: written by
  `_finalise.ts` when a per-table mutation reaches terminal state; consumer: any future DSR
  audit dashboard. **HALF_WIRE_P** (consumer is "future audit dashboard"). Priority **P3**
  because the column is also a regulator-facing artifact for RODO Art. 5(2) accountability — it is
  intentionally written-for-future-read even without an immediate UI consumer. → no FOLLOW;
  accept.
- **Vercel Cron `/api/dsr/mutation-poll` (every 5 min)** — producer: Vercel scheduler (external);
  consumer: route handler. ✅ Wired. Note: requires Vercel Pro plan (per PR #139 design
  decision); if the deployment account is on Hobby plan the cron silently does not fire — but
  this is outside the code-wiring scope.
- **HTTP header `x-vercel-cron-signature`** — referenced as the auth gate for the mutation-poll
  route. Consumer: route handler at `mutation-poll/route.ts`. Producer: Vercel platform. ✅
  Wired.
- **SDK config field `feedbackConvertedFalse`** (carry-over from RETRO-006 LG-2 / FOLLOW-062) —
  still HALF_WIRE_P from Sprint 10. Sprint 11 did NOT close it. Tracked.

**Net Wiring Audit:** **0 new HALF_WIRE or DEAD_CODE findings introduced by Sprint 11 code.**
Three "consumer-side wired, producer = manual config action" cases (DOPPLER_TOKEN_DEV,
E2E_BEARER_TOKEN, E2E_TENANT_ID) are tracked entirely under ESC-009 + FOLLOW-040 escalation —
they are non-engineering blockers. This is the **second consecutive clean wiring audit** (Sprint
10 had 1 P3; Sprint 11 has 0). The retro loop is materially producing the intended asymmetry.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 — `/api/dsr/mutation-poll` is registered as a Vercel Cron but `mutation-poll/route.ts`
  also accepts non-Vercel callers when `VERCEL_CRON_SECRET` is unset.** A read of
  `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts` shows the auth gate is conditional
  on the env var presence. In any environment without that secret (dev, preview deployments
  without Vercel cron config), an attacker who finds the public route URL can manually trigger
  the poll loop. Today this is bounded (only mutates `dsr_clickhouse_mutations.status` from
  `pending` to `done`/`failed` based on what `system.mutations` actually says — no privilege
  escalation possible), but it is a Rule H-amendment shape: mutation endpoint with a permissive
  fallback. Severity **P2** because the worst-case is "an attacker forces faster polling of
  ClickHouse mutations they do not own data in." → **FOLLOW-075** (P2, backend-engineer +
  compliance-engineer, 1h, Sprint 12) — require `VERCEL_CRON_SECRET` on all environments; reject
  401 if unset.
- **LG-2 — `dsr_clickhouse_mutations` table has no TTL or cleanup cron.** Each DSR erase
  request inserts 4 rows (one per PII table). Over time the operational state table grows
  unbounded; even after status='done' there is no archive or purge. Today this is negligible
  (zero pilot tenants, zero real DSR requests), but at pilot scale 50 erases × 4 rows × N tenants
  could grow large. The DSR audit_log itself is retained per Art. 17(3)(b) legal-claims need —
  but the *operational state* table does not carry the same legal weight. Severity **P3**
  long-term. → **FOLLOW-076** (P3, data-engineer, 1h, backlog) — add a cleanup cron that
  archives `status='done' AND completed_at < NOW() - INTERVAL '90 days'` rows to a cold-storage
  table, or just deletes after 90d.
- **LG-3 — ClickHouse retry-on-failure path uses Sentry `dsr_erase_clickhouse_mutation_failed:
  true` tag** (PR #139 design decision), but no test asserts the Sentry tag is actually emitted
  when terminal failure occurs. The unit suite mocks ClickHouse HTTP 500 and asserts the row
  flips to `failed`; the Sentry emission is left to the catch handler in `_finalise.ts`. If
  someone refactors and drops the `Sentry.captureException` call, no test fires. Severity **P3**
  (observability-only, not functional). → **FOLLOW-077** (P3, qa-engineer + compliance-engineer,
  0.5h, backlog) — mock Sentry, assert tag set on terminal failure path.
- **LG-4 — `dsr_clickhouse_mutations.retry_count` increments but there is no max-retries-reached
  alarm.** PR #139 documents "Final terminal failure flips the parent `dsr_audit_log` row to
  `clickhouse_mutation_status = 'failed'` and fires Sentry `dsr_erase_clickhouse_mutation_failed:
  true`." That is a single Sentry event — but no PagerDuty/on-call escalation, no DSR-specific
  dashboard, and no per-tenant alert. For an EU pilot this is a regulator-visible gap (Art. 17
  requires "without undue delay" — typically interpreted as 30 days). Severity **P2** at pilot.
  → **FOLLOW-078** (P2, compliance-engineer + devops-engineer, 1.5h, Sprint 12) — add a
  dashboard panel surfacing DSR mutations stuck in `failed` state, weekly digest email, and a
  Sentry alert escalation policy for `dsr_erase_clickhouse_mutation_failed` (P2 → on-call
  rotation if >0 in 24h).

#### 4b. Code bugs not caught

- **CB-1 — `demo-integration.yml` has TWO different soft-skip strategies that can mask each
  other.** First gate: `DOPPLER_TOKEN_DEV` absence → exit 0 with `::notice`. Second gate (line
  ~131): Next.js server returns 5xx → exit 0 with `::warning title=demo-integration server not
  healthy`. If `DOPPLER_TOKEN_DEV` IS set but Doppler dev is missing `DATABASE_URL` or
  `SUPABASE_SERVICE_ROLE_KEY`, the server boots but returns 503 → second gate triggers → CI
  passes green. This is "soft-skip inception" — every layer says "I could not run, but I am OK with
  that" and the cumulative effect is "the job is structurally present but never actually runs
  against a real DB." Severity **P2** — defeats the entire point of FOLLOW-068. Need to either
  (a) tighten the second gate to fail loud after FOLLOW-040 lands, or (b) ship a `demo-integration
  -strict` variant on push:main only that does not soft-skip. → **FOLLOW-079** (P2, qa-engineer +
  devops-engineer, 1h, Sprint 12) — once `DOPPLER_TOKEN_DEV` provisioned, flip the inner gates
  to fail-loud and add `demo-integration-required` to branch protection.
- **CB-2 — Commitlint regex widening in PR #135 does not accept `[FOLLOW-NNN]` in commit
  subjects with the same flexibility as `[TICKET-NNN]`.** The new regex is
  `\[FOLLOW-\d+\]` (numeric only). But the FOLLOW namespace is already crowded — e.g. there
  could be `[FOLLOW-039a]` for a follow-up to FOLLOW-039 (analogous to the `\d+[a-z]?` pattern
  for TICKET-). Today no FOLLOW has a letter suffix, so the gap is latent. Severity **P3**. →
  **FOLLOW-080** (P3, devops-engineer, 0.25h, backlog) — change regex to `\[FOLLOW-\d+[a-z]?\]`
  for parity with TICKET pattern.
- **CB-3 — `.gitleaks.toml` allowlist for cross-runtime HMAC test fixtures is path-keyed
  broadly.** Fix commit `318c9fa` added paths to gitleaks allowlist after PR #136's first run
  failed. The allowlist matches file paths; if someone moves the test fixture or adds another
  test in a different path, gitleaks regression will reoccur. Severity **P3**. → no FOLLOW;
  document in the test file header that fixture keys MUST use `tenant_api_key_` / `tenant_test_key_`
  prefixes (which the gitleaks rule passes by design).
- **CB-4 — `RETROSPECTIVES.md` was added to `.prettierignore` (fix commit `9ca058e`), but
  RETRO-005, -006 entries have already been auto-wrapped by prior format runs.** Going forward,
  long lines in new retros will not break CI. But the existing entries are now in a hybrid state
  (some wrapped, some not). Future readers will see inconsistent line lengths within the same
  file. Severity **P3** cosmetic. → no FOLLOW; accept the hybrid state.

#### 4c. Test coverage gaps

- **TG-1 — `mutation-poll/route.ts` polling/retry/Sentry integration is unit-tested but not
  integration-tested against a real ClickHouse instance.** The unit suite mocks the ClickHouse
  HTTP response. A real ClickHouse mutation goes through `system.mutations` async semantics that
  the unit mocks cannot fully exercise (e.g. `is_done=0` then `is_done=1` transitions, error
  formats from real ClickHouse Cloud, partition-level mutation scheduling). Without an
  integration smoke test against a real ClickHouse instance, a production regression in the poll
  loop would only surface when a real DSR erase happens — which by definition is when it matters
  most. Severity **P1** for any EU pilot. → **FOLLOW-081** (P1, qa-engineer + data-engineer, 3h,
  Sprint 12) — add a ClickHouse Cloud integration test in `tests/e2e/dsr-erasure.spec.ts` that
  inserts test rows, fires erase, polls until terminal, asserts deletion. Guard behind
  `RUN_CLICKHOUSE_INTEGRATION=true` flag — match the FOLLOW-068 pattern but with a separate
  workflow for ClickHouse Cloud creds.
- **TG-2 — Cross-runtime HMAC test (FOLLOW-069) covers 12 fixture pairs but does not cover
  request body MUTATION between SDK and server.** The fixture pairs are static strings on both
  sides. In production, the SDK builds `JSON.stringify({ tenant_id, session_id, archetype,
  variant, converted, timestamp })`. The server reads `req.text()`. If a future change adds a
  middleware that mutates the body (e.g. Sentry breadcrumb hook, OTel span attribute extractor,
  any request wrapper that consumes-and-restreams), the HMAC will silently fail. Severity **P2**.
  → **FOLLOW-082** (P2, qa-engineer, 1h, Sprint 12) — add an end-to-end HMAC test that uses the
  REAL SDK code path to build the body, posts to a REAL server route handler (mocked-DB), and
  asserts signature verification.
- **TG-3 — `archetype-embeddings-not-null` CI job is conditional on
  `github.ref == 'refs/heads/main' && github.event_name == 'push'` — it does NOT run on PRs.**
  This is correct (PRs cannot connect to staging DB), but it means the precheck only catches
  drift after the merge. A PR that drops a row's embedding (via SQL migration or a script change)
  will pass PR CI green and only fail on the next push to main. Severity **P3** — there is no
  realistic path to "PR drops embedding row" given the migration is already applied; but if
  a future migration adds a 19th archetype without a seed, the gap will surface. → no FOLLOW;
  accept.
- **TG-4 — No regression test asserts that `commitlint.config.cjs` accepts `[FOLLOW-NNN]`.**
  PR #135 widened the regex but did not add a test that calls commitlint with a FOLLOW-tagged
  subject and asserts pass. If someone refactors the regex and drops the FOLLOW branch, CI
  catches nothing until the next retro-loop commit fails. Severity **P3**. → no FOLLOW; accept.

#### 4d. Documentation gaps

- **DG-1 — `.prettierignore` and `.gitleaks.toml` exemptions are not justified in any agent-facing
  doc.** A future agent rewriting `RETROSPECTIVES.md` formatting (e.g. running
  `pnpm prettier --write backlog/RETROSPECTIVES.md` "to be helpful") will fight against the
  exemption without understanding why. Same for the gitleaks allowlist for test fixtures —
  prefix conventions for HMAC test keys need to be a documented constraint. → **FOLLOW-083**
  (P3, architect, 0.5h, Sprint 12) — add `.prettierignore` rationale comment (already present
  in the file as of fix commit `9ca058e`) AND add a `CONTRIBUTING.md` section "Test fixture
  naming conventions for gitleaks compatibility."
- **DG-2 — `vercel.json` cron addition is not documented in any runbook.** The
  `/api/dsr/mutation-poll` cron requires Vercel Pro plan. If the deployment account is on Hobby,
  the cron silently does not fire and DSR mutations never complete — but `dsr_audit_log` will
  show the erase as "initiated" forever. No documentation surfaces this dependency. Severity
  **P2** for any production deploy. → **FOLLOW-084** (P2, architect + devops-engineer, 0.5h,
  Sprint 12) — add a `docs/runbooks/vercel-cron-dependencies.md` listing required Vercel plan +
  cron paths + failure mode if absent.
- **DG-3 — ESC-009 and the FOLLOW-040 escalation are filed as TWO SEPARATE entries in
  ESCALATIONS.md but they have the same root (Piotr provisioning a GitHub Actions secret).**
  Reading both, an operator might think they are two separate ~10 minute tasks; in reality, the
  Doppler service token generation (FOLLOW-040 escalation, ~10 min) is independent of the
  E2E_BEARER_TOKEN JWT generation (ESC-009, also ~10 min but requires `JWT_SECRET` access). Both
  must complete to unlock FOLLOW-063/068/039 enforcement. → **FOLLOW-085** (P3, pm-orchestrator,
  0.25h, Sprint 12) — consolidate the two escalations into a single "Sprint 11 pilot-readiness
  unblock checklist" entry in ESCALATIONS.md OR cross-link them explicitly.
- **DG-4 — Master Design §V.6.1 was updated by PR #138 (Doppler token scoping table) but
  §V.3.3 (INTERNAL_API_SECRET threat model, FOLLOW-073) was NOT addressed.** FOLLOW-073 is
  READY in Sprint 11 but did not ship. Master Design §V section still has the gap RETRO-006
  flagged. Carry-over to Sprint 12.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- All 5 P1 Sprint 11 tickets DONE. 4 P2 tickets (FOLLOW-065 / FOLLOW-071 / FOLLOW-073 /
  FOLLOW-074) remain READY in Sprint 11 — should be moved to Sprint 12 backlog at sprint close
  or executed parallel-light.

#### 5b. Future sprint tickets affected

- **Sprint 12 (Pilot launch — TBD scope):** RETRO-007 surfaces 11 new FOLLOW-UPs (075–085). The
  highest-priority items affecting pilot readiness:
  - **FOLLOW-081 (P1):** ClickHouse mutation-poll integration test — without this, the EU pilot
    is technically compliant on paper but functionally unverified.
  - **FOLLOW-078 (P2):** DSR failure alerting — regulator-visible at pilot.
  - **FOLLOW-079 (P2):** Tighten demo-integration soft-skips once FOLLOW-040 provisioning lands.
  - **FOLLOW-082 (P2):** End-to-end HMAC test with real SDK body construction.
- **ESC-009 + FOLLOW-040 escalation:** Both are ONE manual Piotr action (~20 min total). Once
  complete, all 3 RETRO-006 P1 carry-overs go from "structurally closed" to "operationally
  enforced."
- **TICKET-NATIVE-001 (BLOCKED):** No direct Sprint 11 impact. LG-2 / FOLLOW-064 from RETRO-006
  (SDK `_feedbackListenerRegistered` per-instance refactor) is still open and must land before
  NATIVE-001 unblocks.
- **TICKET-CAUSAL-001 (BACKLOG, P2):** Sprint 11 did not affect this. Still gated on
  `archetype_embeddings.embedding` being non-NULL operationally (which now requires
  FOLLOW-040 + ESC-009 unblock to be enforced via CI; the data itself was seeded manually on
  2026-05-22).
- **FOLLOW-073 (Sprint 11 READY, not shipped):** INTERNAL_API_SECRET threat model still
  undocumented. Master Design §V.3.3 still has the wrong content (it is "Input validation", not
  the INTERNAL_API_SECRET model). Carry to Sprint 12.

#### 5c. Contracts changed that other modules rely on

- **`POST /api/dsr/erase` response shape** — added `clickhouse_mutation_ids` and `status` fields.
  No callers exist today (DSR endpoints are user-facing, not module-to-module). Documented in
  PR #139 + Master Design §H.1.1.
- **`commitlint.config.cjs`** — accepts `[FOLLOW-NNN]` going forward. This affects every agent's
  commit messages. PM-orchestrator + worker agent prompts should reference the broadened
  pattern when scaffolding commit messages.
- **`vercel.json` crons** — additive; requires Vercel Pro plan as a deploy-time precondition.

#### 5d. Architectural assumptions affected

- **Master Design §H.1 / §H.1.1 — DSR erasure semantics.** PR #139 added §H.1.1 documenting the
  Vercel Cron polling pattern, retry strategy, idempotency via `dsr_clickhouse_mutations`. This
  is now Master_Design-as-truth: any future change to the DSR erase pipeline must update §H.1.1.
- **Master Design §V.6.1 — Doppler token scoping.** PR #138 added the dev/prod scoping table.
  Production secrets are Vercel-only by policy; dev tokens go in GitHub Actions secrets.
- **Master Design §W.7.3 — Data Governance / retention.** PR #139 reconciled the pre-existing
  "daily cron" wording with the actually-shipped 5-minute Vercel Cron. Doc-as-truth restored.
- **Operating Principles §Y.3 — Snapshot.1 re-verification.** RETRO-007 is the **second**
  execution of this rule (RETRO-006 was the first). See §7 below.
- **CONVENTIONS_PATCH.md Rule H amendment (2026-05-23).** Sprint 11 PR #139 ships
  `POST /api/dsr/erase` with cryptographic verification via OTP from Sprint 9 GDPR-002 — the
  mutation endpoint did NOT ratchet auth after the fact. Pattern-compliance for Rule H amendment:
  ✅ this sprint upheld the rule. PR #138 introduced soft-skips on dev-only env vars but for a
  CI workflow (not a mutation endpoint), which is out of Rule H amendment scope.

### 6. New lesson candidates

- **Pattern E: "Soft-skip-on-missing-config" as a deliberate CI ship pattern.** Seen 3× in
  Sprint 11 (PR #135 archetype-embeddings-not-null, PR #137 demo-integration, PR #138
  doppler-verify). All three use the same shape: ship the workflow with `continue-on-error:
  true` or explicit `exit 0` when a required secret is absent; emit a clear log line; activate
  automatically when the secret lands. This is a **good pattern** — it allows engineering to
  ship structurally without being blocked on human ops actions. Count: **1 retro, 3 instances.**
  **Threshold met as a class within one retro**, but per the 2-retros rule it is not yet
  promoted. Recommend tracking; promote to a Rule if Sprint 12 ships another instance.
  Proposed name: **"Rule K — Ship structurally, activate operationally"** — CI jobs that depend
  on a manual provisioning action SHOULD ship as soft-skip workflows with a clear log line and
  an ESCALATIONS.md entry, not block on the provisioning. **Defer to Sprint 12 retro.**
- **Pattern F: "Soft-skip inception" — multiple layered soft-skips that mask each other.** Seen
  RETRO-007 CB-1 only (demo-integration.yml has DOPPLER gate + server-health gate). Count: **1
  retro, 1 instance.** **Threshold NOT MET**, track. If a Sprint 12 workflow ships with the same
  shape, promote a Rule K amendment that requires "at least one layer in any soft-skip
  workflow MUST be fail-loud once its sibling escalation resolves."
- **Pattern G: "Test fixture key prefix triggers gitleaks generic-api-key rule."** Seen RETRO-007
  CB-3 only. Count: **1 retro, 1 instance.** **Threshold NOT MET**, track. Recommend adopting a
  fixture-key prefix convention now (`tenant_api_key_*` / `tenant_test_key_*` / `mock_*`) to
  preempt future occurrences.
- **Pattern H: Rule H closure velocity continues.** Sprint 10 closed 4 of 4 P0/P1 half-wires
  from RETRO-005 and opened 1 P3. Sprint 11 closed all 3 P1 half-wires from RETRO-006
  (structurally) and opened 0 new HALF_WIRE findings. **Two consecutive net-closure sprints.**
  This is a positive process-health signal. Recommend formalising it as a **retro health
  metric** in future sprint rollups: "delta_half_wires = closed - opened". Negative is bad
  (net-opening); positive is good. Sprint 11 = +3 net closures.

### 7. Master_Design updates

**Verdict:** Two updates warranted. The first row update is straightforward (B.4 listing-embedding
auto-seed gap (b) is now fully closed by FOLLOW-046 for demo tenant, plus the FOLLOW-068 CI job
that activates once DOPPLER_TOKEN_DEV lands closes gap (c) structurally). The second is a
Snapshot.1 prose update for Sprint 11 close.

**Edit M-12 — §Snapshot.1 row B.4 (line 213):**

- **Old:** "...(c) e2e integration spec shipped via PR #130 (FOLLOW-055) — guarded behind
  `NEXT_PUBLIC_TEST_E2E=true`, CI does not yet run it (FOLLOW-068 tracks the CI job). **Remaining
  open gaps:** (a) Magic-Link email flow still BLOCKED (TICKET-040). **Note:** Auto-Detection
  Engine itself = §B.5 = Mostly Shipped per Sprint 7.5. |"
- **New:** "...(c) e2e integration spec shipped via PR #130 (FOLLOW-055) and **CI job
  `demo-integration` provisioned in PR #137 (FOLLOW-068)** — soft-skips until DOPPLER_TOKEN_DEV
  + E2E_BEARER_TOKEN are provisioned (ESC-009 carry-forward). **Remaining open gaps:** (a)
  Magic-Link email flow still BLOCKED (TICKET-040); (d) ESC-009 + FOLLOW-040 escalation block CI
  enforcement of FOLLOW-063 / FOLLOW-068 / FOLLOW-039 cron — code is structurally ready, awaits
  manual secret provisioning (~20 min Piotr action). **Note:** Auto-Detection Engine itself =
  §B.5 = Mostly Shipped per Sprint 7.5. |"

**Edit M-13 — §Snapshot.1 row F (line 226):**

- Append to the existing row text: **"Sprint 11 FOLLOW-063 (PR #135) ships
  `archetype-embeddings-not-null` CI precheck (push:main, soft-skip until DOPPLER_TOKEN_DEV
  provisioned) + `post-migrate-seed.yml` idempotent auto-seed on every push to main. Once
  ESC-009 / FOLLOW-040 escalation resolves, the cosine path will be enforceable in CI for any
  fresh DB pull."**

**Edit M-14 — §Snapshot.1 "Updates" prose block (after line 190):**

Append a new sentence at the end of the existing prose block:

- **Add after the existing "Sprint 11 OPEN (2026-05-23)" entry:**
  `**Update 2026-05-24 (Sprint 11 close — RETRO-007):** Sprint 11 COMPLETE — 5 PRs merged (#135, #136, #137, #138, #139). All 5 P1 pilot-blockers DONE: FOLLOW-063 (archetype seed CI + auto-seed workflow), FOLLOW-068 (demo-integration CI job), FOLLOW-069 (cross-runtime HMAC compat + LG-3 regression guard), FOLLOW-040 (Doppler service token + doppler-run wrapper), FOLLOW-039 (ClickHouse DSR hard-delete — EU pilot gate cleared; Master Design v2.4 + §H.1.1 added). Net 0 HALF_WIRE findings; second consecutive net-closure sprint. **Open gaps surfaced by RETRO-007:** ESC-009 (E2E_BEARER_TOKEN provisioning) + FOLLOW-040 escalation (DOPPLER_TOKEN_DEV provisioning) — both are manual Piotr actions (~20 min total) that unlock CI enforcement of FOLLOW-063/068/039. FOLLOW-081 (P1, ClickHouse integration test for mutation-poll). FOLLOW-075 (P2, VERCEL_CRON_SECRET enforcement). 4 P2 carry-overs from Sprint 11 (FOLLOW-065/071/073/074) remain READY. Per OP §Y.3 and the AGENT_WORKFLOW.md sprint-close checklist, the next Snapshot.1 re-verification is at Sprint 12 completion.`

**Edit M-15 — §Snapshot.4 priority list (Immediate 1–2 weeks):**

The current priority #1 reads "Sprint 11 (OPEN 2026-05-23): close 3 pilot-blockers..." — that
sentence is now stale. Replace with:

- **Old:** "1. **Sprint 11 (OPEN 2026-05-23): close 3 pilot-blockers..."
- **New:** "1. ~~**Sprint 11 (OPEN 2026-05-23): close 3 pilot-blockers...**~~ **Sprint 11 CLOSED
  2026-05-24** — all 5 P1 pilot-blockers DONE (FOLLOW-063, FOLLOW-068, FOLLOW-069, FOLLOW-039,
  FOLLOW-040). EU pilot gate cleared; Master Design v2.4. **Next priority:** ESC-009 +
  FOLLOW-040 escalation (Piotr ~20 min) → unlocks operational enforcement of the 3 new CI jobs.
  Then Sprint 12 priorities from RETRO-007 §5b: FOLLOW-081 (P1 ClickHouse integration test),
  FOLLOW-078 (P2 DSR failure alerting), FOLLOW-079 (P2 tighten demo-integration soft-skips after
  unblock), FOLLOW-073 (P2 INTERNAL_API_SECRET threat model carry-over from RETRO-006)."

#### 7a. Master_Design version bump

**Master Design is already at v2.4** (bumped by PR #139 for FOLLOW-039 §H.1.1 addition). No
further version bump needed for the §Snapshot.1 edits — they are documentation-status updates
within the existing v2.4 cycle. The v2.4 header text can be amended to reflect Sprint 11 close
instead of "Sprint 11 in flight":

- **Old:** `**Wersja:** 2.4 (Sprint 11 in flight — FOLLOW-039 ClickHouse DSR hard-delete shipped, RODO Art. 17 fully compliant for EU pilot; §H.1.1 erasure semantics added)`
- **New:** `**Wersja:** 2.4 (Sprint 11 close — all 5 P1 pilot-blockers DONE; FOLLOW-039 ClickHouse DSR hard-delete shipped, RODO Art. 17 fully compliant for EU pilot; §H.1.1 erasure semantics added; CI seed/demo/HMAC gates structurally present)`

### 8. Edits applied

This retrospective directly modifies `docs/MASTER_DESIGN.md` per Edits M-12 through M-15 +
version header refinement. Applied 2026-05-24 by retrospective-analyst.

### 9. Follow-ups

(Each appended as a stub to `backlog/FOLLOW_UPS.md` in this commit. Numbering continues from
FOLLOW-074.)

- **FOLLOW-075** — Require VERCEL_CRON_SECRET on `/api/dsr/mutation-poll`; reject 401 if unset
  (backend-engineer + compliance-engineer, 1h, **P2**, Sprint 12) — closes LG-1
- **FOLLOW-076** — Cleanup cron for `dsr_clickhouse_mutations` operational state table
  (90-day TTL after status='done') (data-engineer, 1h, **P3**, backlog) — closes LG-2
- **FOLLOW-077** — Test asserts Sentry `dsr_erase_clickhouse_mutation_failed` tag fires on
  terminal failure path (qa-engineer + compliance-engineer, 0.5h, **P3**, backlog) — closes LG-3
- **FOLLOW-078** — DSR failure alerting: dashboard panel + weekly digest + Sentry escalation
  policy for `dsr_erase_clickhouse_mutation_failed` (compliance-engineer + devops-engineer,
  1.5h, **P2**, Sprint 12) — closes LG-4; **EU pilot regulator-visibility**
- **FOLLOW-079** — Tighten `demo-integration.yml` soft-skips after FOLLOW-040 unblocks; flip
  inner gates to fail-loud on push:main; add `demo-integration` to branch protection
  (qa-engineer + devops-engineer, 1h, **P2**, Sprint 12) — closes CB-1
- **FOLLOW-080** — Widen `commitlint.config.cjs` FOLLOW regex to `\[FOLLOW-\d+[a-z]?\]` for
  parity with TICKET pattern (devops-engineer, 0.25h, **P3**, backlog) — closes CB-2
- **FOLLOW-081** — ClickHouse Cloud integration test for `mutation-poll/route.ts` poll +
  retry + Sentry path; gated behind `RUN_CLICKHOUSE_INTEGRATION=true` workflow (qa-engineer +
  data-engineer, 3h, **P1**, Sprint 12) — closes TG-1; **blocks EU pilot confidence**
- **FOLLOW-082** — End-to-end HMAC test with REAL SDK body construction + REAL server route
  handler (mocked-DB); guards against body-mutation middleware regressions (qa-engineer, 1h,
  **P2**, Sprint 12) — closes TG-2
- **FOLLOW-083** — Document `.prettierignore` + `.gitleaks.toml` test-fixture exemption
  rationale in CONTRIBUTING.md; add HMAC fixture key prefix convention (architect, 0.5h, **P3**,
  Sprint 12) — closes DG-1
- **FOLLOW-084** — `docs/runbooks/vercel-cron-dependencies.md` listing required Vercel Pro plan
  + cron paths + failure mode if absent (architect + devops-engineer, 0.5h, **P2**, Sprint 12) —
  closes DG-2
- **FOLLOW-085** — Consolidate ESC-009 + FOLLOW-040 escalation into a single "Sprint 11
  pilot-readiness unblock checklist" entry in ESCALATIONS.md with cross-links (pm-orchestrator,
  0.25h, **P3**, Sprint 12) — closes DG-3

### 10. Rule promotion

**No new Rule promotion this retro.** Threshold not met for any of the 3 candidate patterns
(E, F, G — all 1 retro, 1–3 instances within same retro). Track for Sprint 12.

The existing Rule H amendment (2026-05-23, codified in CONVENTIONS_PATCH.md) held cleanly for
all 5 Sprint 11 PRs. PR #139 (mutation endpoint with cryptographic OTP via Sprint 9 GDPR-002) is
the only Sprint 11 PR that ships a state-mutating endpoint, and its auth is already
production-grade. PR #138 (Doppler verify) is a CI utility, not a state-mutating endpoint, so
Rule H amendment does not apply.

### 11. Cross-references

- **RETRO-006 (Sprint 10):** This retro is the direct closure pass for 3 P1 RETRO-006 carry-overs
  — LG-1 (archetype seed CI), TG-1 (demo CI), TG-2 (HMAC compat). All 3 structurally closed. The
  retro loop's predicted FOLLOW-063 / FOLLOW-068 / FOLLOW-069 each became a Sprint 11 P1 ticket
  that shipped. Second consecutive sprint where RETRO-N predictions drove RETRO-N+1 sprint
  scope. The learning loop is materially functioning.
- **RETRO-005 (Sprint 9.5):** FOLLOW-046 (listing embedding auto-seed for non-demo tenants)
  remains open and was NOT closed by Sprint 11. The Sprint 9.5 → Sprint 10 → Sprint 11 chain has
  closed 5 of 7 RETRO-005 P0/P1 findings; FOLLOW-046 non-demo automation and the Magic-Link
  email flow (gap (a) in §Snapshot.1 row B.4) remain.
- **RETRO-002 / RETRO-003:** Rule H originally codified here. Sprint 11 is the SEVENTH
  consecutive retro where Rule H is the dominant analytical lens, and the SECOND consecutive
  retro showing net closure. Rule H amendment from RETRO-006 §6a (mutation-endpoint auth must
  ship same PR) is now permanent in CONVENTIONS_PATCH.md.
- **CONVENTIONS_PATCH.md Rule A (Verify CI green before READY_FOR_REVIEW):** Held for all 5
  Sprint 11 PRs. No PR #125-style billing-blocked merge.
- **CONVENTIONS_PATCH.md Rule H (Schema scaffold MUST ship with at least one runtime-wired
  consumer):** Held for all 5 PRs.
- **CONVENTIONS_PATCH.md Rule H amendment (2026-05-23 mutation-endpoint same-PR auth):** Held
  for PR #139 (the only state-mutating endpoint introduced this sprint).
- **CONVENTIONS_PATCH.md Rule I (Wired-or-dead):** Held. Sprint 11 added 0 new dead symbols.
- **CONVENTIONS_PATCH.md Rule J (Mirror-Code Sync Gate):** Held. Sprint 11 did not touch any
  mirrored files. `clickhouse-dsr.ts` is control-plane-only and not mirrored to decision-api.
- **Operating Principles §Y.3 (Snapshot.1 re-verification at sprint close):** RETRO-007 IS the
  SECOND execution. §7 above performs the verification; §8 applies the edits inline below.

---

## RETRO-008 — TICKET-PILOT-003 (CTA lift dashboard with holdout comparison) — 2026-05-25

### 1. Summary of change

- **PR:** #146 (merged 2026-05-25 11:39 UTC, commit `6f0fbe1`)
- **Files changed:** 8 (+1,509 / −20)
- **Modules touched:** control-plane (API route + dashboard page + lib), configs (commitlint),
  docs/ops (ESCALATIONS.md). No SDK / ingest / decision-api / shared / data-engine code touched.
- **Key contracts changed:**
  - `GET /api/pilot/cta-lift?window_days=<7|14|30>` — new route — breaking: no (additive)
  - `@/lib/pilot-stats` exports `twoProportionZTest`, `classifyConfidence`, `relativeLiftPct`,
    `normalCDF`, `MIN_SAMPLE_PER_ARM`, `type PilotConfidence` — new — breaking: no
  - `./route-helpers` exports `CtaLiftResponse`, `PilotSummary`, `FunnelRow`, `ArchetypeRow`,
    `FUNNEL_STAGES`, `parseWindowDays`, `buildResponseFromRaw`, `ChRawData` family — new — breaking: no
  - `/dashboard/pilot` page — modified (union-merged with TICKET-PILOT-004 content) — breaking: no
  - `commitlint.config.cjs` — `PILOT-` ticket prefix added to allow-list — breaking: no

### 2. Verification done in PR

- Test files changed: `pilot-stats.test.ts` (new, 14 cases), `route.test.ts` (new, 12 cases) — 26 total.
- Assertions added: ~60 across both files.
- Coverage delta: `pilot-stats.ts` is exhaustively covered (every branch: n<30, se=0, equal rates,
  known-significant fixture p≈0.00072, null-on-zero-holdout, both arms). `route-helpers.ts`
  `buildResponseFromRaw` covered for summary/funnel/archetype assembly, missing-stage zeroing, sort
  order. `route.ts` GET covered for 401 (no JWT, staff-without-tenant), mock path, ClickHouse path
  with bound params assertion, all-zero rows, and the fail→mock fallback. Estimate ≥85% on the three
  new files.
- CI checks: passed (merged to main; PR squashed 4 commits including the route-helpers split fix and
  the extension-less import fix).
- **Statistical-correctness verdict:** `twoProportionZTest` is mathematically correct — pooled
  proportion `pPool=(p1·n1+p2·n2)/(n1+n2)`, pooled SE, two-tailed `2·(1−Φ(z))`, n≥30 guard, se=0
  guard. The A&S 7.1.26 erf approximation (max error 1.5e-7) is appropriate for a dashboard p-value.
  The canonical fixture (0.15 vs 0.10, n=1000) yields p≈0.00072 as asserted. No statistical defect
  found. (See §4a for a divergence-from-sibling-implementation note — not a correctness bug.)

### 3. Wiring Audit

- **DEAD_CODE** — none. Every new file/symbol has a non-test runtime consumer:
  `pilot-stats.ts` → consumed by `route-helpers.ts`; `route-helpers.ts` → consumed by `route.ts` and
  `page.tsx` (via duplicate interface, see §4a); `route.ts` GET → Next.js file-based route (framework
  discovery, false-positive suppressed); `page.tsx` → Next.js page route; `/dashboard/pilot` nav link
  → wired in `layout.tsx`. `normalCDF`/`MIN_SAMPLE_PER_ARM` are exported and consumed by tests +
  internal callers.
- **HALF_WIRE_C** — `event_type:cta.clicked` (consumer side of the producer/consumer test). The
  cta-lift query CONSUMES `events.type = 'cta.clicked'` joined to `adaptation_decisions.holdout_group`
  on `(tenant_id, session_id)`. Producer of `cta.clicked` events is the SDK (`packages/shared`
  schema literal exists, `listing-observe.ts:59`), but the SDK→ingest→ClickHouse `events` wiring for
  `cta.clicked` on the pilot tenant is established by TICKET-PILOT-001 (still READY, not yet run). At
  merge time the consumer query exists with no verified live producer feeding the `events` table for
  the pilot tenant. This is partially mitigated because the route silently falls back to mock data on
  empty/failed queries (see §4b CB-1) — which is itself the more dangerous finding. Priority **P1**
  (data wiring completes at PILOT-001 activation; not a code defect) → FOLLOW-092.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P2) — Third parallel two-proportion z-test implementation in the repo, and second parallel
  CTA-lift query path.** This PR adds `@/lib/pilot-stats.twoProportionZTest`. There is already
  `apps/decision-api/src/lib/ab-assignment.ts:148 twoProportionZTestPValue` (RETRO-002, Rule J/CI
  manifest scope) and the older `apps/control-plane/src/app/api/dashboard/analytics/lift/route.ts`
  (which computes the very same adapted-vs-holdout CTA lift). The two z-tests use different erf/CDF
  approximations (A&S 7.1.26 vs A&S 26.2.17) — both valid, but they will not be byte-identical and
  there is no cross-check test. This is the same "duplicate stats/logic across decision-api and
  control-plane" pattern flagged in RETRO-003 (§reorder/affinity dup), RETRO-005 (PR #122/#123 bandit
  + reorder mirrors → Rule J), and RETRO-006 (Rule J promoted permanent). See §6.
- **LG-2 (P1) — Schema-convention divergence between the two CTA-lift query paths.** New
  `cta-lift/route.ts` joins `events.type = 'cta.clicked'` (dotted, canonical per
  `packages/shared/src/schemas/events/index.ts:211`) on `adaptation_decisions.ts`. The pre-existing
  `analytics/lift/route.ts:99` joins `dqs_events.event_type = 'cta_clicked'` (underscored, different
  table) on `adaptation_decisions.assigned_at`. Same business metric, two different
  table/column/event-name vocabularies. The new route uses the canonical event name and a `ts`
  column; the old route uses a non-canonical `cta_clicked` against a `dqs_events` table and
  `assigned_at`. At least one of these is querying a stale or wrong source. Whichever is correct, the
  two dashboards (`/dashboard/analytics` lift panel vs `/dashboard/pilot` summary) will report
  divergent CTA-lift numbers for the same tenant/window. → FOLLOW-093.
- **LG-3 (P3) — `adaptation_decisions.ts` column assumption is unverified against the ClickHouse
  migration.** The new query filters/joins on `ad.ts` and uses `anyHeavy(holdout_group)` per session
  in the funnel subquery. The DSR code references `adaptation_decisions` but the column ddl
  (`ts` vs `assigned_at`, presence of `archetype`/`holdout_group`) is not co-located with this PR and
  was not asserted by a test (mock path bypasses real SQL). The `analytics/lift` route uses
  `assigned_at` for the same table — these cannot both be right. → folded into FOLLOW-093.

#### 4b. Code bugs not caught

- **CB-1 (P1) — Mock fallback masks ClickHouse query failures on the PRIMARY pilot metric.**
  `route.ts:GET` does `const raw = await fetchCtaLiftRaw(...).catch(() => null); const data = raw ??
  buildMockRaw(...)`. `fetchCtaLiftRaw` returns `null` only when `CLICKHOUSE_URL` is unset; on any
  query failure (HTTP 500, malformed SQL, auth error, schema drift) it THROWS, the `.catch(()=>null)`
  swallows it, and the route serves `buildMockRaw()` — which is deliberately engineered to show a
  realistic, statistically significant CTA lift. In production with `CLICKHOUSE_URL` set, a broken
  query therefore returns fabricated "significant lift" on the pilot's primary success metric with a
  200 status and no error signal. A test even asserts this behavior (`route.test.ts:524 'falls back
  to mock data when ClickHouse query fails'`). For a dashboard whose entire purpose is the go/no-go
  ROI decision, silently fabricated success data is the highest-severity finding in this retro. This
  is the same "swallow errors silently → fall back to a plausible-looking default" class as RETRO-006
  CB-1 (`postFeedbackPing` swallows all errors → bandit sits at uniform). → FOLLOW-094 (P1).
- **CB-2 (P2) — Mock fallback is indistinguishable from real data on the wire.** The `CtaLiftResponse`
  has no `data_source`/`is_mock` flag and no `X-Data-Source` header. A reviewer (or Piotr at go/no-go)
  cannot tell whether the numbers shown came from ClickHouse or `buildMockRaw`. FOLLOW-086 defers
  removal of the mock entirely, but until then the response is ambiguous. → folded into FOLLOW-094.

#### 4c. Test coverage gaps

- **TG-1 (P2) — No test asserts the actual SQL text/structure of the three ClickHouse queries.** The
  ClickHouse-path test stubs `fetch` and only asserts the bound `param_tenant_id` / `param_window_days`
  query-string params and that JSONEachRow lines parse. It never asserts the SELECT/JOIN/event-name
  shape, so the `events.type='cta.clicked'` vs `assigned_at` vs `ts` divergence (LG-2/LG-3) is
  invisible to CI. A snapshot test of the emitted SQL would have surfaced the convention mismatch.
- **TG-2 (P3) — No test asserts the page-level union wiring** (that all four panels render and that
  `windowDays` drives both `/api/pilot/cta-lift` and `/api/pilot/inquiry-starts`). The page.tsx merge
  was a manual add/add conflict resolution; a component/RTL test would guard the union. Low severity —
  the wiring was verified by manual read in this retro (§4d / §5a) and is correct.

#### 4d. Documentation gaps

- **DG-1 (P3) — Master Design does not document the `/api/pilot/cta-lift` route or the
  `/dashboard/pilot` page.** Pilot ROI instrumentation (Lane C) is a shipped surface but absent from
  §Snapshot.1 / route inventory. Folds naturally into the existing route-inventory follow-ups
  (FOLLOW-060 family). → folded into FOLLOW-093 acceptance (note the dual-route situation when
  documenting).

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-004 (DONE, PR #144)** — shares `page.tsx`. The union merge is correct: `page.tsx`
  renders `SummaryPanel` (PILOT-003) → `InquiryStartsPanel` (PILOT-004) → `FunnelPanel` (003) →
  `ArchetypePanel` (003), all four wired; the single `windowDays` state drives both fetch calls in one
  `useEffect` with a shared `cancelled` guard. Both panels have independent loading flags
  (`ctaLoading` / `inquiryLoading`). No regression to PILOT-004. Verified by direct read of
  `page.tsx:508-610`.
- **TICKET-PILOT-001 (READY)** — provides the live `cta.clicked` event flow (SDK→ingest→ClickHouse)
  and `CLICKHOUSE_URL` provisioning that the cta-lift route consumes. Until PILOT-001 runs, the route
  serves mock data; combined with CB-1, the pilot dashboard can show fabricated lift before any real
  traffic exists. PILOT-001's go/no-go (PILOT-002 runbook) must include "verify cta-lift is reading
  real ClickHouse data, not mock."
- **TICKET-PILOT-002 (READY, runbook)** — the go/no-go checklist must add a mock-vs-real data
  verification step for the primary metric (consequence of CB-1/CB-2).

#### 5b. Future sprint tickets affected

- **FOLLOW-086 (Sprint 12 post-pilot, P2)** — directly continues this work (replace mock with real
  queries). CB-1 elevates the urgency: the mock should fail loud (or expose `is_mock`) BEFORE pilot
  go-live, not "post-pilot." Recommend FOLLOW-094 be sequenced ahead of / merged into FOLLOW-086.
- **FOLLOW-091 (inquiry-starts mock → real)** — sibling of FOLLOW-086 for the PILOT-004 panel; same
  mock-masking risk class. The two should be addressed together when `CLICKHOUSE_URL` lands.

#### 5c. Contracts changed that other modules rely on

- No existing consumer relied on a changed contract (all additions). BUT `page.tsx` re-declares the
  `CtaLiftResponse` / `PilotSummary` / `FunnelRow` / `ArchetypeRow` / `PilotConfidence` interfaces as
  hand-written duplicates instead of importing them from `./route-helpers` (server route). If the
  route response shape changes, the page types silently drift — exactly the duplicate-interface
  contract-drift class flagged in RETRO-005 (`DetectApiResponse` dup → FOLLOW-044) and codified in the
  Rule G / Rule I family. → FOLLOW-095 (P2).

#### 5d. Architectural assumptions affected

- **Spec-vs-implementation location divergence.** TICKET-PILOT-003 spec (QUEUE.md:2003 and
  `backlog/sprint-12/TICKET-PILOT-003.md`) says "Build dashboard panel in **/dashboard/analytics**."
  The implementation shipped at **/dashboard/pilot** (a new page, unified with PILOT-004). This is a
  reasonable product decision (a dedicated pilot dashboard separate from the general analytics page)
  but it diverges from the written spec and was not recorded as a decision. Two consequences: (1) the
  pre-existing `/dashboard/analytics` lift panel (`analytics/lift/route.ts`) now coexists with the new
  pilot dashboard, both claiming CTA lift (see LG-2); (2) anyone following the spec to find the panel
  looks in the wrong place. → noted in FOLLOW-093.

### 6. New lesson candidates

- **Pattern: "A new module re-implements a statistical/business computation that already exists in
  another package, with no cross-implementation parity test, producing divergent numbers for the same
  metric."** Seen in: this retro (LG-1: third z-test + second cta-lift path), RETRO-002 (consent-
  vocabulary divergence between AB-001 and GDPR-004), RETRO-003 (`affinityScore`/`buildReorderDirective`
  duplicated across two files), RETRO-005 (PR #122/#123 bandit + reorder mirrors; duplicate
  `DetectApiResponse`), RETRO-006 (Rule J promoted permanent for mirror-code).
  - Threshold to promote: 2 occurrences — current count: **5 prior + this = 6**. THRESHOLD MET.
  - **However:** Rule J already covers "mirror-code sync gate for cross-runtime duplicates" and Rule I
    covers "wired-or-dead." The specific new wrinkle here is **intra-runtime duplicate business logic
    that is NOT a cross-runtime mirror** (both implementations are TypeScript, both server-side, but in
    different packages: control-plane vs decision-api, and two routes within control-plane). Rule J's
    "byte-identical cross-runtime" framing does not cleanly apply. This is rule-worthy as a Rule J
    extension. → Rule K appended (see §9).
- **Pattern: "Error/empty path silently substitutes plausible-looking default data instead of failing
  loud, hiding broken wiring."** Seen in: this retro (CB-1 mock fallback on query failure), RETRO-006
  (CB-1 `postFeedbackPing` swallows all errors → uniform bandit), RETRO-005 §4 (several producer-only
  half-wires "the demo script will silently degrade").
  - Threshold: 2 — current count: **2 prior + this = 3**. THRESHOLD MET, but the existing Rule H
    ("schema scaffold must ship with a runtime-wired consumer") and the §3 HALF_WIRE machinery already
    target the wiring-completeness side. The distinct new element is "fallback masks a runtime
    failure." Given two strong prior instances and a P1 finding here, this is also rule-worthy. Folded
    into Rule K as a second clause (fail-loud on data-source failure for decision-grade surfaces).

### 7. Follow-ups

- FOLLOW-092: Verify `cta.clicked` event flow (SDK→ingest→ClickHouse `events`) is live for the pilot
  tenant before activating the cta-lift dashboard (data-engineer + sdk-engineer, 2h, **P1**)
- FOLLOW-093: Reconcile the two CTA-lift query paths — `pilot/cta-lift` (events.type/`ts`) vs
  `analytics/lift` (dqs_events.event_type/`assigned_at`); pick the canonical table/column/event-name
  vocabulary, fix the wrong one, document the route inventory (data-engineer, 4h, **P1**)
- FOLLOW-094: Make the cta-lift route fail loud on ClickHouse error and expose data provenance
  (`is_mock`/`data_source`) instead of silently serving fabricated significant lift (data-engineer +
  backend-engineer, 3h, **P1**)
- FOLLOW-095: Import `CtaLiftResponse` & sibling types into `page.tsx` from `./route-helpers` instead
  of re-declaring them, to prevent contract drift (backend-engineer, 1h, **P2**)
- FOLLOW-096: Cross-implementation parity test for the two-proportion z-test
  (`@/lib/pilot-stats.twoProportionZTest` vs `decision-api ab-assignment.twoProportionZTestPValue`) —
  shared fixture set, assert agreement to a tolerance (qa-engineer, 2h, **P2**)

### 8. Cross-references

- Related to RETRO-002: introduced the first `twoProportionZTestPValue` (decision-api) and the
  consent-vocabulary divergence pattern; this retro adds the third z-test and a fresh schema-vocabulary
  divergence (LG-2).
- Related to RETRO-005 / RETRO-006: mirror-code / duplicate-interface / duplicate-business-logic
  pattern that produced Rule I and Rule J; this retro extends it to intra-runtime cross-package
  duplication (Rule K).
- Related to RETRO-006 CB-1: the silent-error-swallow → plausible-default class (here CB-1 mock
  fallback on the primary pilot metric).

---

## RETRO-009 — TICKET-PILOT-004 (Inquiry starts tracking) — 2026-05-25

### 1. Summary of change

- **PR:** #144 (merged 2026-05-25 ~08:52 UTC / 10:52 +0200, commit `10917dc`)
- **Files changed:** 7 (+1,090 / −0)
- **Modules touched:** SDK (`packages/sdk`), control-plane (`apps/control-plane`), configs (auto-detect
  fixture), backlog (FOLLOW_UPS.md)
- **Key contracts changed:**
  - `ObserverOptions` — new exported interface in `packages/sdk/src/core/observer.ts` with optional
    `inquirySubmitSelector` — added — breaking: no
  - `setupObservers(config, onEvent, options?)` — gained optional 3rd arg `options: ObserverOptions = {}`
    — changed — breaking: no (defaulted)
  - `InquiryStartsResponse` / `DailyBreakdownRow` — new exported interfaces in `inquiry-starts/route.ts` —
    added — breaking: no
  - `GET /api/pilot/inquiry-starts?window_days=<1..90>` — new route — breaking: no
  - `inquiry.started` SDK event — now emitted conditionally from the observer (the wire is incomplete —
    see §3)
  - `000-app-estalara/detail-ground-truth.json` — added `inquiry_form_selector` + `inquiry_submit_selector`
    fields — additive
  - NOTE: `dashboard/pilot/page.tsx` was created in this PR but **overwritten by PR #146** (TICKET-PILOT-003)
    union merge. The live file holds all 4 panels (Summary + InquiryStarts + Funnel + Archetype). The diff
    for `10917dc` shows the PILOT-004-only single-panel version; the merged-state file is the union. This was
    a manual add/add conflict resolution (verified correct in RETRO-008 §5a).

### 2. Verification done in PR

- Test files changed: `packages/sdk/src/__tests__/observer-inquiry.test.ts` (new, 7 tests),
  `apps/control-plane/src/app/api/pilot/inquiry-starts/route.test.ts` (new, 9 tests)
- Assertions added: ~40 across 16 tests (SDK: emit/payload=`contact_v2`/consent-gate/no-selector/timestamp/
  click-scope/cleanup; API: two 401 paths, top-level shape, zero-data shape, daily-row shape, lift null|number,
  `total = adapted + holdout` invariant, default window=30, mock determinism)
- Coverage delta: positive on both new files; exact % unknown. **Gap:** the SDK test injects the selector
  DIRECTLY into `setupObservers`, so it cannot detect that the production init path never supplies it (see §3).
- CI checks: passed (per QUEUE.md merge record; corpus gate 100/100). A TS-narrowing fix (`resolvedSelector`
  const capture) landed as a 2nd commit on the PR.

### 3. Wiring Audit

- **HALF_WIRE_P** — `sdk_event:inquiry.started` — producer at `packages/sdk/src/core/observer.ts:156`
  (inside `onInquirySubmitClick`, guarded by `if (inquirySubmitSelector && config.consentState !== 'opted_out')`)
  — the producer code path is **never reached in production**: the sole runtime caller
  `setupObservers(config, (event) => {...})` at `packages/sdk/src/index.ts:265` (call closes at `index.ts:352`)
  passes only TWO arguments, so `options` defaults to `{}`, `inquirySubmitSelector` is always `undefined`, and
  the inquiry click-listener is never registered. The detected `inquiry_submit_selector`
  (`000-app-estalara/detail-ground-truth.json:19`) is never read into `ObserverOptions` by any non-test code.
  Net effect: `inquiry.started` fires only in unit tests; zero events reach ingest → ClickHouse in prod.
  priority **P1** → FOLLOW-097

  Classification rationale: scored **HALF_WIRE_P** (producer exists in code but is never triggered), not P0
  HALF_WIRE_C, because the API consumer (`GET /api/pilot/inquiry-starts`) does not crash on missing data — it
  falls back to deterministic mock data — so nothing breaks at runtime; the feature silently delivers no real
  signal. It is the SDK producer wire that is missing at init. This is a **Rule H** half-wire (event scaffold
  shipped without a runtime-reachable producer) and a **sub-case that Rule I's CI gate does NOT catch**, because
  `setupObservers` and `ObserverOptions` ARE imported and used — only the new conditional parameter branch is
  dead. (See §6 for the lesson-candidate analysis.)

- **DEAD_CODE (CHECK A):** none. `inquiry-starts/route.ts` is consumed by `page.tsx` (fetch on
  `/api/pilot/inquiry-starts`); the `observer.ts` change is reached via `index.ts:265`; `ObserverOptions` is
  used in the `setupObservers` signature; `InquiryStartsResponse`/`DailyBreakdownRow` are exported and consumed
  by the route + test. `page.tsx` is a Next.js file-based route — framework-discovered, false-positive
  suppressed.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P1, central):** `inquiry_submit_selector` from the tenant site schema is never plumbed
  detection → schema store → SDK config → `ObserverOptions.inquirySubmitSelector`. The feature chain has a
  missing middle link at SDK init. TICKET-PILOT-001 (Lane B, READY) will hit this: its spec wires the SDK into
  app.estalara.com `+layout.svelte` but says nothing about threading the inquiry selector into `setupObservers`.
  Without an explicit fix, PILOT-001 installs the SDK and the secondary pilot metric reads empty/mock forever.
- **LG-2 (P3):** `payload.form_variant` is hardcoded to the literal `'contact_v2'` (`observer.ts:158`)
  regardless of which form fired or what the schema says. Acceptable for a single-form pilot; would mislabel
  all inquiries for multi-form tenants. Flag for post-pilot.

#### 4b. Code bugs not caught

- **CB-1 (P2): inquiry-starts route renders mock data in a real browser when `CLICKHOUSE_URL` is absent, with
  no provenance flag.** `route.ts:617-622` returns `buildMockResponse()` whenever `CLICKHOUSE_URL` is unset OR
  any ClickHouse call fails (`fetchFromClickHouse(...).catch(() => null)`). On a Vercel preview (or any env
  missing the pilot ClickHouse var), the dashboard shows plausible, deterministic, fabricated inquiry counts and
  a fake lift badge with no `data_source`/`is_mock` signal. This is the **same class as RETRO-008 CB-1**
  (`cta-lift/route.ts`) and is **already codified as CONVENTIONS_PATCH.md Rule K.2** (decision-grade surfaces
  must fail loud / expose provenance). FOLLOW-094 fixes the cta-lift route only; the inquiry-starts route needs
  the same treatment. → FOLLOW-098 (P2)
- Not a Rule H violation: the route IS consumed and FOLLOW-091 + the `// MVP stub — replaced by FOLLOW-091`
  header comment satisfy the Rule H mock-deferral clause. CB-1 is a Rule K.2 / UX-trust bug, distinct from
  wiring.

#### 4c. Test coverage gaps

- **TG-1:** No test exercises the production init path emitting `inquiry.started`. `observer-inquiry.test.ts`
  injects the selector directly, so it cannot fail when `index.ts` omits it (LG-1 is invisible to CI). A test
  that drives the real SDK init (or asserts `setupObservers` receives a non-empty `options.inquirySubmitSelector`
  when the tenant schema carries one) would have caught it. → folded into FOLLOW-097 AC.
- **TG-2:** No test asserts the SDK-emitted `inquiry.started` payload validates against
  `InquiryStartedEventSchema` from `@estalara/shared`. The schema accepts `{ form_variant: 'contact_v2' }`
  (`form_variant` is `z.string().optional()` — verified at `packages/shared/src/schemas/events/inquiry.ts:19`),
  so it is currently fine, but a contract test pinning SDK emission to the shared Zod schema would prevent drift.
  → folded into FOLLOW-097 AC.

#### 4d. Documentation gaps

- **DG-1 (P3):** SDK `ObserverOptions` / `inquirySubmitSelector` is not in Master Design §B.1 SDK-config
  surface table — same omission class as FOLLOW-071 (`feedbackEvents`/`feedbackUrl`) and RETRO-008 DG-1. Fold
  into the existing SDK-config-surface documentation sweep (FOLLOW-071 family) rather than a new stub.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 12, READY, `depends_on: [TICKET-PILOT-004]`):** Directly affected and the
  highest-impact cascade. Activation must thread the detected `inquiry_submit_selector` into the SDK
  `setupObservers` `options` at init, or the secondary pilot metric is dead on arrival. FOLLOW-097 is the
  prerequisite fix; PILOT-001 should depend on it or absorb it. **PM action recommended.**
- **TICKET-PILOT-002 (Sprint 12, READY, go/no-go runbook):** The go/no-go checklist must add
  "`inquiry.started` events observed in ClickHouse during shadow mode" — symmetric to the cta-lift mock-vs-real
  check RETRO-008 §5a required for the PRIMARY metric. Otherwise the runbook green-lights a pilot whose
  secondary metric silently reports mock/zero.

#### 5b. Future sprint tickets affected

- **FOLLOW-091 (Sprint 13, P2 — inquiry-starts mock → real):** Now COUPLED to FOLLOW-097. Replacing the mock
  is pointless until the producer actually emits `inquiry.started`. FOLLOW-091 AC should gain the precondition
  "FOLLOW-097 shipped and `inquiry.started` rows present in ClickHouse for the pilot tenant."
- **FOLLOW-086 (Sprint 12 post-pilot, P2 — cta-lift mock → real):** Sibling stub; FOLLOW-098 (this retro's
  inquiry-starts fail-loud fix) should be sequenced alongside FOLLOW-094 (cta-lift fail-loud) — both are Rule K.2
  remediation for the two pilot routes.

#### 5c. Contracts changed that other modules rely on

- `setupObservers` gained an optional 3rd param — backward compatible; the only non-test caller
  (`index.ts:265`) passes 2 args and is unaffected.
- `inquiry.started` was ALREADY a registered event in `packages/shared/src/schemas/events/index.ts:198`
  (EVENT_TYPES union) and is referenced by `cta-lift/route.ts` (funnel stage + weight maps) and
  `cta-lift/route-helpers.ts:25`. So ingest validation and downstream consumers were ready before this PR —
  only the SDK emission wire is missing.

#### 5d. Architectural assumptions affected

- Master Design §B.9 (Tier 3 Native on app.estalara.com) assumes the SDK reads the detected site schema and
  wires behavioral observers accordingly. The current SDK init consumes NO per-tenant schema selectors into
  `ObserverOptions` (the inquiry selector is the first such field), so the "detected schema drives runtime SDK
  behavior" assumption is only partially realized. No Master Design edit needed beyond DG-1's config-surface
  documentation.

### 6. New lesson candidates

- **Pattern A — "Conditional code path keyed on a new function parameter that the sole production caller never
  supplies" (Rule-H half-wire that escapes the Rule-I CI gate).** The symbol IS imported and used; only the new
  `if (param) { ... }` branch is dead because no non-test caller passes the param.
  - Seen in: RETRO-009 (this — `inquirySubmitSelector`). Prior Rule-H half-wires (FOLLOW-006 ab.assignment
    unproduced, FOLLOW-007 `thompsonSample` zero-importer, FOLLOW-041/042 SDK variant consumer) were the
    "symbol with zero non-test importers" form, which Rule I's CI gate DOES catch. The parameter-branch
    sub-case is distinct.
  - Threshold to promote: 2 — current count for this **specific sub-case: 1**. Do NOT codify yet. If it
    recurs, the right home is a Rule I extension: "a newly added optional parameter whose body is gated by
    `if (param)` must have ≥1 non-test call site supplying it." Tracked here for the next retro.
- **Pattern B — "Browser-reachable GET route renders deterministic mock data with no provenance flag when its
  datastore env var is absent."** Seen in: RETRO-009 (this — `inquiry-starts/route.ts`) AND RETRO-008
  (`cta-lift/route.ts`).
  - Count: 2 (RETRO-008 + RETRO-009). Threshold met — **but this pattern is ALREADY codified as Rule K.2**
    (promoted by RETRO-008). No new rule needed; RETRO-009 records the inquiry-starts route as a fresh Rule K.2
    instance and emits FOLLOW-098 to remediate it. (Confirming the loop: Rule K.2 was promoted one retro ago and
    already catches this finding — the system is working as intended.)

### 7. Follow-ups

- FOLLOW-097: Thread the detected `inquiry_submit_selector` into SDK `setupObservers(options)` at init + add a
  production-path test (sdk-engineer + backend-engineer, 2h, priority **P1**)
- FOLLOW-098: Apply Rule K.2 to `inquiry-starts/route.ts` — fail loud on ClickHouse error when `CLICKHOUSE_URL`
  is set, expose `data_source`/`is_mock`, dashboard "sample data" banner (backend-engineer, 1.5h, priority
  **P2**)

### 8. Cross-references

- **RETRO-008 (TICKET-PILOT-003, sibling pilot ticket, same `page.tsx`):** Shares Pattern B
  (mock-in-browser); RETRO-008 promoted Rule K.2 which now catches this retro's CB-1. RETRO-008's FOLLOW-094
  (cta-lift fail-loud) and this retro's FOLLOW-098 (inquiry-starts fail-loud) are siblings and should be
  sequenced together. RETRO-008 verified the `page.tsx` union merge is correct (no PILOT-004 regression).
- **RETRO-001 / RETRO-002 (Rule H evidence chain — FOLLOW-001/006/007/008/010/014):** The next instance of the
  half-wire pattern, in a new sub-form (dead conditional branch vs. zero-importer symbol).
- **RETRO-005 (FOLLOW-041/042 — SDK variant consumer half-wire):** Same module (`packages/sdk`), same failure
  mode (SDK feature shipped but not wired into the runtime init path).
- **RETRO-006 §6 / FOLLOW-071 (SDK config surface not in Master Design §B.1):** DG-1 folds into that open sweep.

---

## RETRO-SPRINT-12 — Sprint 12 (Controlled pilot launch on app.estalara.com — Lane A hardening + Lane B onboarding + Lane C ROI) — 2026-05-25

**Scope:** Sprint-level retrospective for Sprint 12, written at sprint close by pm-orchestrator (per OP §Y.3). Sprint 12 was the "controlled pilot launch" sprint approved by the AI Council Checkpoint 2026-05-24. Three-lane structure: Lane A (pilot-critical hardening, gates Lane B), Lane B (app.estalara.com onboarding via Magic Link + shadow mode), Lane C (CTA-lift + inquiry-starts ROI instrumentation, parallel with Lane B). This is the **third execution** of OP §Y.3 (Snapshot.1 re-verification at sprint close, after RETRO-006 and RETRO-007).

**Outcome in one line:** Lane A and Lane C shipped in full; Lane B (the actual pilot onboarding) was deliberately deferred to Sprint 13 because RETRO-008/009 surfaced P1 correctness blockers in the very dashboards Lane C shipped — the pilot's go/no-go metrics could display fabricated success. Closing Sprint 12 on instrumentation+hardening and re-opening pilot launch as the headline of Sprint 13 (gated behind a correctness lane) is the safer path.

### Sprint-level rollup

| Metric | Value |
| --- | --- |
| Sprint goal | Controlled pilot launch on app.estalara.com (Lane A hardening → Lane B onboarding; Lane C ROI in parallel) |
| PRs merged | 5 (#142 FOLLOW-075, #143 FOLLOW-081, #144 TICKET-PILOT-004, #145 FOLLOW-078, #146 TICKET-PILOT-003) |
| Ticket completion | Lane A 3/3 DONE (FOLLOW-081/075/078); Lane C 2/2 DONE (PILOT-003/004); Lane B 0/2 (PILOT-001/002 DEFERRED → Sprint 13) |
| Tickets CANCELLED | 1 (FOLLOW-079 demo-integration fail-loud → split into FOLLOW-088/089/090) |
| Tickets DEFERRED | 2 (TICKET-PILOT-001, TICKET-PILOT-002 → Sprint 13 Lane B) |
| Per-ticket retros | RETRO-008 (PILOT-003), RETRO-009 (PILOT-004) |
| P1 correctness blockers surfaced | 4 (FOLLOW-092, FOLLOW-093, FOLLOW-094, FOLLOW-097) — gate pilot go-live |
| Pilot actually launched? | **No** — shadow-mode onboarding (Lane B) did not start |
| Master_Design version | v2.7 → v2.8 (Sprint 12 CLOSED, Sprint 13 OPEN with pilot launch + intent build) |
| New ADRs | 0 |
| New permanent Rules | 0 (Rule K.2 already promoted by RETRO-008) |

### What went well

1. **EU pilot infrastructure is genuinely hardened.** Lane A closed the DSR erasure confidence gap end-to-end: ClickHouse mutation-poll integration test against `system.mutations` (FOLLOW-081 PR #143), CRON_SECRET 401 enforcement on the poll endpoint (FOLLOW-075 PR #142), and Sentry alerting on stuck/failed mutations (FOLLOW-078 PR #145). The regulator-visible "erase initiated but never completes" failure mode now alerts.
2. **ROI instrumentation shipped.** Both pilot metrics have dashboards: CTA-lift with two-proportion z-test + conversion funnel + by-archetype table (PILOT-003 PR #146) and inquiry-starts tracking (PILOT-004 PR #144), unified on `/dashboard/pilot`.
3. **The retro loop caught the trap before launch.** RETRO-008/009 found that both pilot dashboards fabricate plausible (and statistically-significant) data on ClickHouse error/absence, and that `inquiry.started` never fires in production (selector not threaded into SDK init). Catching this at sprint close — rather than after a pilot showed fake success — is the loop working as designed.

### What to fix (carried into Sprint 13 Lane A — correctness)

1. **Dashboards must stop fabricating metrics (CB-1 class, Rule K.2).** FOLLOW-094 (cta-lift) + FOLLOW-098 (inquiry-starts): separate "ClickHouse unset → legitimate dev/CI mock" from "ClickHouse set but query failed → must surface error + Sentry, never fabricate." Expose `data_source` provenance. These are launch blockers, not polish.
2. **`inquiry.started` is a Rule-H half-wire that Rule I's CI gate misses.** FOLLOW-097: the symbol is imported (so Rule I is satisfied) but the new conditional branch is dead because `setupObservers(config, onEvent)` never passes the `options` object carrying `inquirySubmitSelector`. The secondary pilot metric produces zero prod events today. New sub-form of the half-wire pattern: dead branch, not zero-importer symbol.
3. **Two divergent CTA-lift query paths.** FOLLOW-093: `/api/pilot/cta-lift` (joins `events.cta.clicked` on `adaptation_decisions.ts`) vs `/api/dashboard/analytics/lift` (joins `dqs_events.cta_clicked` on `assigned_at`) will report different numbers for the same tenant/window. Reconcile onto one schema vocabulary before the metric is treated as authoritative.
4. **Producer→consumer not verified live.** FOLLOW-092: confirm `cta.clicked` actually lands in ClickHouse for the pilot tenant once TICKET-PILOT-001 runs — the dashboard cannot be trusted until the producer path is observed end-to-end.

### FOLLOW-079 cancellation — lessons

FOLLOW-079 ("flip demo-integration soft-skips to fail-loud, add to branch protection") was cancelled mid-sprint (PR #141 closed unmerged) because a single 1-hour ticket simultaneously tripped **three independent enforcement mechanisms** that were not all ready to merge together:

- Rule I (wired-or-dead) reported 105 zero-importer symbols across `packages/sdk` + `packages/shared`.
- The Python CI matrix referenced a non-existent `apps/adaptation-engine` directory → every `Test (Python)` job failed.
- The demo-integration fail-loud step is blocked on ESC-010 (`DOPPLER_TOKEN_DEV`) + ESC-009 (`E2E_BEARER_TOKEN`) secrets that are still unprovisioned.

**Lesson (LG):** a "tighten the gate" ticket is deceptively small — flipping a soft-skip to fail-loud surfaces every latent failure the soft-skip was masking. These should be scoped as **discovery tickets** ("inventory what fails when the gate is enforced") rather than 1-hour fixes, and split per failure mechanism up front. The correct decomposition (FOLLOW-088 prettier, FOLLOW-089 Python matrix, FOLLOW-090 Rule I + demo-integration after ESC-010) was only visible *after* attempting the merge. Codifying as a soft pattern; not yet a Rule (single occurrence).

**Lesson (process):** the unprovisioned secrets (ESC-009/010) have now blocked CI enforcement across three sprints (FOLLOW-040/063/068 soft-skip, FOLLOW-079 cancellation, and now FOLLOW-087 in Sprint 13 cannot reach green CI). The ~20-minute manual provisioning is on the critical path and should be done before Sprint 13 Lane C starts.

### Snapshot.1 re-verification (OP §Y.3)

No implementation status changed materially this sprint relative to the pre-existing Snapshot.1 verdicts — Lane A hardened existing compliance infrastructure (row H already ✅ Shipped) and Lane C added dashboards (row B.7/§D.9 observability, still 🟡 Partial pending real ClickHouse traffic). Intent detection (row D) remains 3 behaviorally-discriminable archetypes; the §D.6 13/18 coverage is a post-FOLLOW-099/100 projection, not current state. Snapshot.1 will move when Sprint 13 Lane C (FOLLOW-099/100) lands. No Snapshot.1 edits required at this close.

### Cross-references

- **RETRO-008 / RETRO-009 (per-ticket, PILOT-003/004):** source of the 4 P1 correctness blockers (FOLLOW-092/093/094/097/098) now forming Sprint 13 Lane A.
- **RETRO-007 (Sprint 11):** the EU pilot gate (FOLLOW-039) it cleared is what made Sprint 12's Lane A hardening meaningful; the ESC-009/FOLLOW-040 secret-provisioning gap it flagged is still open and still blocking.
- **CONVENTIONS_PATCH.md Rule K.2:** promoted by RETRO-008; FOLLOW-094/098 are its enforcement on the two pilot routes.

---

## RETRO-010 — FOLLOW-105 Wave 1 (canonical /api/adapt enforcement, ADR-0006) — 2026-05-25

### 1. Summary of change

- **PR:** #150 (merged 2026-05-25, squash commit `bf0585d`; superseded the ESC-011-blocked PR #149)
- **Files changed:** 29 (+1,399 / −1,382 — the large deletion is the Worker `/api/adapt` handler +
  its `adapt.test.ts` suite collapsing from 960 → ~120 lines)
- **Modules touched:** SDK (`packages/sdk`), control-plane (`apps/control-plane`),
  decision-api (`apps/decision-api`), shared (`packages/shared`), docs (ADR-0004/0006/README,
  MASTER_DESIGN), configs (CI scripts `check-adapt-schema-drift.{sh,cjs}`, `check-rule-h.sh`,
  `pnpm-lock.yaml`, ClickHouse migration 0012), backlog (QUEUE/FOLLOW_UPS/ESCALATIONS), and
  CONVENTIONS_PATCH.md (Rule H amendment).
- **Key contracts changed:**
  - `AdaptationDirectives.adapt_decision_id: string` (`packages/shared/src/directives.ts`) — **added,
    required** — breaking: **yes** for any inline mock/fixture of the type (Rule G class — see §4).
  - `packages/sdk/src/core/adapt-schema.ts` — **new** `adaptResponseSchema` (Zod `.passthrough()`)
    replacing the unchecked `as AdaptResponse` cast in `adapt.ts` — breaking: no (internal), but it
    makes `adapt_decision_id` a runtime-required field on every adapt response the SDK accepts.
  - `buildSnippet(tenantId, apiKey)` (`DetectionPreview.tsx`) — now **exported** + emits
    `data-decision-url="${CONTROL_PLANE_URL}/api"` — breaking: no (additive attribute); **this is the
    BLOCKER fix** — previously the wizard snippet omitted `data-decision-url`, and the SDK guard
    `if (!config.decisionApiUrl) return null` silently disabled adaptation for every wizard-onboarded
    tenant.
  - `POST/GET /api/adapt` (control-plane) — every response arm (GET, POST skip, POST holdout, POST
    treatment) now returns `adapt_decision_id` — breaking: no (additive field).
  - `POST /api/adapt` (decision-api Worker) — **replaced with `410 Gone`** + structured logging —
    breaking: **yes** for any live caller of the Worker route (intended; ADR-0004 §2 already forbade
    production use).
  - `DECISION_API_URL` (`packages/shared/src/domains.ts`) — `@deprecated` — breaking: no.
  - ClickHouse `adaptation_decisions.adapt_decision_id` column (migration 0012) — added with `''`
    default — breaking: no (additive).

### 2. Verification done in PR

- Test files changed/added: `packages/sdk/src/__tests__/adapt-schema.test.ts` (new),
  `packages/sdk/src/__tests__/adapt-canonical-url.integration.test.ts` (new),
  `packages/sdk/src/__tests__/adapt.test.ts` (9 fixtures repaired), `apps/decision-api/.../adapt.test.ts`
  (rewritten to 410-only — 960→~120 lines), `DetectionPreview.test.tsx` (buildSnippet assertions),
  `mockup/layout.test.tsx` (new), `packages/sdk/e2e/fixtures/index.html` (mock adapt response gained
  `adapt_decision_id`).
- Assertions added: ~50 (adaptResponseSchema valid/missing/mismatch/out-of-enum/passthrough +
  Sentry+null path; canonical-URL integration `snippet→readConfig→fetchDirectives` resolves to
  `https://admin.estalara.com/api/adapt`; buildSnippet emits absolute https decision-url ending `/api`;
  Worker 410 status + body shape + canonical host + no-archetype-selection + structured-logging-fires).
- Coverage delta: net positive on SDK (`adapt-schema.ts` exhaustively covered) and DetectionPreview;
  decision-api adapt suite shrank (no logic left to test beyond the 410 contract).
- CI checks: **green at merge** on all real merge gates (Build, control-plane build, typecheck, lint,
  Test Node 22, SDK E2E, `rule-h` incl. the two new adapt gates, `rule-j`, format, corpus, ClickHouse,
  Doppler, Gitleaks). Pre-existing-red Rule I / Vercel Preview / Python lanes remain non-blocking per
  QUEUE.md preamble. **Caveat:** CI was only obtained after ESC-011 was resolved (branch rename +
  Actions-budget bump) — see §4 PF-1; the `feat/...` PR #149 ran **zero** CI for hours.

**NOT verified by tests (load-bearing gaps — see §4):**

- No test asserts the **POST skip/holdout arms LOG `adapt_decision_id` to ClickHouse** — they return it
  in the body but never call `logDecisionAsync` (LG-1). The cross-correlation story is body-only on
  those arms.
- No test exercises a **live (non-mock) adapt response** through the SDK Zod schema against the real
  control-plane route — drift is gated structurally by `check-adapt-schema-drift.cjs` (field-set
  equality) but value-level contract conformance is only checked against hand-written fixtures.

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- `packages/sdk/src/core/adapt-schema.ts` (new) — `adaptResponseSchema` is imported and used by
  `packages/sdk/src/core/adapt.ts` (`fetchDirectives` parse path). Verified non-test importer present.
  **Clean.**
- `buildSnippet` (`DetectionPreview.tsx`) now `export`ed — consumed by the component itself + the test;
  the export was added purely for unit testing. Component is a Next.js client component reached from the
  onboarding wizard. **Clean** (false-positive class: component used in JSX, not via named import chain).
- `apps/decision-api/src/app/api/adapt/route.ts` (`handleAdaptRequest`) — still wired into the Worker
  `index.ts` router (returns 410). **Clean as wired**, BUT it is now the sole reason the decision-api
  lib layer is retained — see HALF_WIRE note below and §4 LG-2.
- CI scripts `check-adapt-schema-drift.{sh,cjs}`, `check-rule-h.sh` extension — invoked by the `rule-h`
  CI job + pre-push lefthook (framework/config-discovered). **Clean.**

**Orphaned-by-this-merge (DEAD_CODE, already owned by FOLLOW-107):** the decision-api lib layer
`apps/decision-api/src/lib/{ab-assignment,ab-events,consent-gate,llm-gateway,reorder}.*` lost its sole
production consumer when the Worker `/api/adapt` handler became a 410 stub. These are now
production-unreachable (Rule I violations). **Not emitting a new FOLLOW** — FOLLOW-107 (Sprint 14)
already owns their removal — but see §4 LG-2: FOLLOW-107's current scope text names the route file and
the libs in prose, which is adequate. The Rule I CI lane is (correctly) pre-existing-red and tracks
these until FOLLOW-107 lands.

**CHECK B — Half-wire detection:**

- **DB column `adaptation_decisions.adapt_decision_id` (ClickHouse, migration 0012)** — producer:
  `logDecisionAsync(...)` on the GET arm and the POST **treatment** arm of the control-plane route;
  consumer: no read path yet (future audit/cross-correlation; the body `adapt_decision_id` is the
  primary artifact). Producer-present, no immediate reader → **HALF_WIRE_P**. Priority **P3** (the
  column is an intentionally written-for-future-read audit artifact, same disposition as RETRO-007's
  `dsr_audit_log.clickhouse_mutation_status`). → no FOLLOW; accept. **Asymmetry note:** the POST skip
  and holdout arms return `adapt_decision_id` in the body but DO NOT write it to ClickHouse — so for
  held-out / consent-skipped sessions there is no row to correlate against. Tracked as LG-1 → FOLLOW-110.
- **Response field `adapt_decision_id` (SDK side)** — producer: control-plane route (all arms);
  consumer: SDK `adaptResponseSchema` requires it (else `.parse()` throws → `null`). Both ends shipped
  same PR. ✅ Wired. The E2E browser fixture was the one missing consumer-mock and was fixed in-PR.
- **Worker `/api/adapt` 410 structured log** — producer: `console.warn('[decision-api] DEPRECATED ...')`
  on every call; consumer: **a human reading logs / the FOLLOW-107 zero-traffic decision** — there is no
  automated 7-day zero-traffic monitor or alert. This is the *sole* signal gating FOLLOW-107 retirement,
  yet it is an unstructured-destination `console.warn` with no dashboard, query, or threshold defined.
  **HALF_WIRE_P** (signal emitted, no consumer wired to act on it). Priority **P2** because FOLLOW-107's
  go/no-go literally depends on it. → **FOLLOW-111**.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P2) — `adapt_decision_id` logging asymmetry on the skip/holdout arms.** The control-plane
  POST route generates one `adaptDecisionId` per request and returns it in all four arms, but
  `logDecisionAsync(...)` is only called on the GET arm and the POST **treatment** arm. The **skip**
  (consent) and **holdout** arms return the id in the body and then `return` without logging. Result:
  for every held-out or consent-skipped session there is an `adapt_decision_id` on the wire with **no
  corresponding `adaptation_decisions` row** to correlate against. This directly undercuts the
  cross-correlation rationale documented in the `AdaptationDirectives.adapt_decision_id` JSDoc, and it
  matters for FOLLOW-108 (explainability_id) and the pilot's audit story — holdout is exactly the arm
  the CTA-lift comparison (TICKET-PILOT-003) leans on. → **FOLLOW-110** (P2).
- **LG-2 (P3) — FOLLOW-107 scope adequacy.** FOLLOW-107 names `apps/decision-api/src/app/api/adapt/route.ts`
  and lists the orphaned libs (`ab-assignment/ab-events/consent-gate/llm-gateway/reorder`) in its prose
  scope, but its AC list only says "Handler code removed" — it does not enumerate the lib files as
  explicit ACs, so a future agent could remove the route and leave the libs as Rule I red. Minor; folded
  as a one-line AC addition recommendation rather than a new stub (see §7 note). Also: FOLLOW-107's
  zero-traffic AC ("7+ day monitoring shows zero hits") has **no defined monitor** — that is LG-3/FOLLOW-111.
- **LG-3 (P2) — the 410 zero-traffic signal has no monitor.** FOLLOW-107's gating AC assumes a 7-day
  zero-traffic observation exists, but Wave 1 shipped only a `console.warn`. Without a structured sink
  (Cloudflare Workers Logpush → a queryable destination, or a Sentry breadcrumb/metric) and a defined
  query/threshold, FOLLOW-107 cannot be evidenced and will either stall or be approved on a guess. →
  **FOLLOW-111** (P2).

#### 4b. Code bugs not caught

- **CB-1 (P3) — stale host string survives in ADR-0006 prose.** ADR-0006 §Decision 3 still drafts the
  canonical host as `control-plane.estalara.com`; the live host is `admin.estalara.com` (CONTROL_PLANE_URL).
  The code shipped correctly (the 410 body + snippet + tests all use `admin.estalara.com`), and the PR
  commit messages + code comments call out the staleness — but the ADR body itself was annotated rather
  than corrected in one spot. Low risk (a future reader could copy the wrong host from the ADR). → no
  FOLLOW; fold a one-line correction into FOLLOW-107's doc-update AC (it already touches §Snapshot.7).
- **CB-2 (none functional).** The Zod-required-field regression (E2E fixture missing `adapt_decision_id`
  → `adaptedCount=0` → 2 Playwright specs red) was a *real* bug, caught only by CI (not by the vitest
  unit suite, which had its own fixtures repaired separately). It was fixed in-PR (fixture gained the
  field). It is recorded here as the headline test-process finding — see §4c TG-1 + §6 Pattern.

#### 4c. Test coverage gaps

- **TG-1 (P1, process) — making a response field newly-required (Zod / strict typing) is not covered by
  a repo-wide fixture sweep, and vitest unit suites cannot catch a browser-only E2E fixture.** This merge
  required updating mocks in THREE independent places for one field: (a) 9 vitest fixtures in
  `adapt.test.ts`, (b) the new `adapt-schema.test.ts` fixtures, and (c) the Playwright browser fixture
  `e2e/fixtures/index.html`. Only (c) was missed initially and only CI (not local vitest) caught it. This
  is **Rule G's exact pattern** (breaking type change → grep all inline mocks) extended to a surface Rule
  G's verification command (`pnpm typecheck`) does NOT reach: an HTML/JS string fixture is not typechecked.
  I confirmed via grep that **no other adapt-response mock currently omits `adapt_decision_id`** — the
  only browser adapt mock is `e2e/fixtures/index.html` (now fixed) and the `consent`/`adapt-dom-mutations`
  specs reuse that fixture rather than defining their own. So no residual fixture gap exists today. →
  prevention captured as a Rule G amendment recommendation in §6 (NOT promoted — see §10) and a sweep AC
  folded into FOLLOW-109.
- **TG-2 (P2) — no live-contract test for the SDK Zod schema.** `check-adapt-schema-drift.cjs` asserts
  field-set equality between `adaptResponseSchema` and `AdaptationDirectives` (structural). But no test
  feeds an **actual** control-plane `/api/adapt` response (real route handler, mocked DB) through
  `adaptResponseSchema.parse()` to prove value-level conformance. A value-type drift (e.g. server sends
  `confidence` as a string) would pass the structural gate and the hand-written fixtures, then fail only
  in a real browser. → **FOLLOW-112** (P2).

#### 4d. Documentation gaps

- **DG-1 (P3) — ADR-0006 host staleness (= CB-1).** Fold correction into FOLLOW-107. No separate stub.
- **DG-2 (P3) — the `data-decision-url` "host + `/api`, SDK appends `/adapt`" convention is documented
  only in code comments** (`DetectionPreview.tsx`, `mockup/layout.tsx`) and not in any tenant-facing
  install doc or Master Design SDK-config surface table. TICKET-PILOT-001 (manual SDK install on
  app.estalara.com) and any future external tenant snippet will re-derive this and can get it wrong
  (bare host → `/adapt` → 404; relative `/api` → resolves against tenant origin → wrong host). Same
  config-surface-documentation class as RETRO-009 DG-1 / FOLLOW-071. → fold into FOLLOW-071 family sweep
  (no new stub); flagged for TICKET-PILOT-001 in §5a.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **FOLLOW-097 (Sprint 13a, READY — Wave 2):** thread `inquiry_submit_selector` into SDK
  `setupObservers`. Not directly affected by the adapt-response change, but it touches the SAME SDK init
  path (`packages/sdk/src/index.ts`) that the canonical-URL `readConfig` flow runs through. Low coupling;
  no spec change needed.
- **FOLLOW-106 (Sprint 13a, READY — Wave 2):** `tenants.pilot_frozen` flag, with a runtime check in "the
  SDK adapt route." That check must be added to the **canonical control-plane** `/api/adapt`
  (`apps/control-plane/.../route.ts`) — NOT the Worker route, which is now 410. FOLLOW-106's scope text
  says "the SDK adapt route" ambiguously; **PM should confirm FOLLOW-106 targets the control-plane route**
  post-FOLLOW-105. Flagged.
- **TICKET-PILOT-001 (Sprint 13b Lane B, READY, gated behind Lane A):** **Most affected.** The pilot SDK
  install on app.estalara.com must use `data-decision-url="https://admin.estalara.com/api"` (host + `/api`,
  SDK appends `/adapt`). PILOT-001's spec predates this convention. Two concrete risks: (1) if the install
  omits `data-decision-url`, adaptation is silently off (the exact BLOCKER this PR fixed for the *wizard*
  path — but PILOT-001 is a *manual* `+layout.svelte` install, a different code path the wizard fix does
  NOT cover); (2) wrong form (bare host or relative path) → 404 or wrong-origin. **PM action: add an
  explicit AC to PILOT-001 requiring the absolute `${CONTROL_PLANE_URL}/api` decision-url and a smoke
  assertion that the first adapt response is a 200 from `admin.estalara.com/api/adapt`.** This pairs with
  the still-open FOLLOW-097 inquiry-selector threading (RETRO-009) — both are "the manual pilot install
  must wire SDK config that the wizard/tests exercise but the hand-written install does not."

#### 5b. Future sprint tickets affected

- **FOLLOW-107 (Sprint 14):** depends on a zero-traffic monitor that does not exist yet (LG-3 → FOLLOW-111
  is its prerequisite). FOLLOW-107 should `depends_on: [FOLLOW-111]`. Its AC list should enumerate the
  orphaned lib files (LG-2) and correct the ADR-0006 host string (CB-1/DG-1).
- **FOLLOW-108 (Sprint 14, explainability_id):** inherits the LG-1 logging-asymmetry decision — when it
  wires `explainability_id` to the audit trail, it must decide whether holdout/skip arms also persist a
  correlatable row, or the audit trail will have body-only ids with no backing row for those arms.
  FOLLOW-110 (this retro) should land before or with FOLLOW-108.
- **FOLLOW-109 (Sprint 14, SDK Zod rollout):** the direct extension of this PR's `adapt-schema.ts`
  pattern. Its AC should absorb the §4c TG-1 fixture-sweep lesson (every browser/E2E mock of each newly
  Zod-validated response must be updated, not just vitest fixtures) and the TG-2 live-contract test idea.
- **FOLLOW-103 / FOLLOW-104 (Lane C, app.estalara.com DOM adaptation + ReorderDirective):** these consume
  the adapt response `directives[]` array shape via the SDK. The Zod `adaptResponseSchema` uses
  `.passthrough()` and validates the directive discriminated union (text/class/reorder) — so FOLLOW-103/104
  directives WILL validate as long as they conform to the existing `TextDirective`/`ReorderDirective`
  shapes. **No breaking impact**, but FOLLOW-103/104 authors must know: any NEW directive `type` they add
  must be added to `directiveSchema` (the discriminated union in `adapt-schema.ts`) or the SDK Zod parse
  will reject the whole response and return `null` (silently disabling ALL adaptation, not just the new
  directive). This is a sharp edge the `.passthrough()` at the top level does NOT protect against (the
  union is strict on `type`). Flagged for FOLLOW-103/104 specs.

#### 5c. Contracts changed that other modules rely on

- **`AdaptationDirectives` gained a required `adapt_decision_id`.** Any module constructing this type
  inline (control-plane route arms, SDK fixtures, any future Modal/worker producer) must set it. Verified:
  the only producer is the control-plane route (all arms set it); the only validating consumer is the SDK
  schema (requires it); all repo fixtures now include it.
- **Worker `decision.estalara.com/api/adapt` now returns 410.** Any external integration still pointing at
  the Worker host breaks (intended). `DECISION_API_URL` is `@deprecated`; snippet generators must use
  `CONTROL_PLANE_URL`. The buildSnippet fix enforces this for the wizard path; PILOT-001 manual install is
  the remaining unguarded path (§5a).

#### 5d. Architectural assumptions affected

- **Master Design §Snapshot.7 risk #1 (dual `/api/adapt`) — flipped OPEN → RESOLVED** by this merge (per
  QUEUE.md preamble + ADR-0006 ACCEPTED). The architecture now has ONE production adapt path
  (control-plane, 18-archetype + playbook + LLM + RAG); the Worker path is a 410 stub pending FOLLOW-107
  physical removal. This is now Master_Design-as-truth: any reintroduction of archetype-selection logic
  into the Worker is a Rule H-amendment (2026-05-25) CI violation.
- **ADR-0004 → ADR-0006 chain:** ADR-0004's draft response contract was replaced "live wins" with the
  actual `AdaptationDirectives` field table; `explainability_id` is documented as `[DEFERRED to
  FOLLOW-108]`. The ADR corpus now reflects shipped reality rather than the original design draft — a
  healthy doc-as-truth reconciliation.

### 6. New lesson candidates

- **Pattern — "Newly-required response field breaks browser/E2E string fixtures that typecheck cannot
  reach."** This is a **direct extension of the existing Rule G** (breaking type change → grep all inline
  mocks). Rule G's *verification* is `pnpm typecheck`, which catches TS inline mocks but NOT (a) HTML/JS
  string fixtures (`e2e/fixtures/index.html`), (b) JSON fixture files, or (c) any mock that lives outside
  the type system (Playwright `route.fulfill({ body: JSON.stringify(...) })`). Seen in: **RETRO-010 (this)**.
  Prior Rule G evidence: RETRO-001/TICKET-046 (`MOCK_PLAYBOOK` TS inline mock — typecheck-caught). The
  *new sub-case* (out-of-typesystem string/JSON fixture, CI-E2E-caught only) is distinct. **Count for this
  specific sub-case: 1.** Threshold (2) NOT met. Do NOT amend Rule G yet. If it recurs (e.g. FOLLOW-109's
  broader Zod rollout produces the same fixture-miss), promote a Rule G amendment: "When a field becomes
  required on a type that any SDK API response is built from, the grep sweep MUST include `*.html`, `*.json`,
  and Playwright `route.fulfill` bodies — typecheck does not cover these." Tracked here for the next retro.
- **Pattern — "CI-trigger branch-prefix allowlist silently yields zero CI for off-convention branches"
  (process).** ESC-011: PR #149 was on `feat/...`, which matches neither `ci.yml`'s `push.branches`
  agent-prefix allowlist nor (because no PR-to-main existed at that moment, and `pull_request.branches`
  only fires for PRs targeting main) the `pull_request` trigger → **zero CI runs**, so CI-green was
  unverifiable and the ticket could not be marked READY. Fixed by renaming to `architect/FOLLOW-105-...`.
  Seen in: **RETRO-010 (this) — FIRST occurrence in the retro corpus** (grep of RETROSPECTIVES.md for
  branch-naming/CI-trigger findings returned nothing prior). **Count: 1.** Threshold (2) NOT met. Do NOT
  promote a rule. → **FOLLOW-113** (P2) hardens this structurally regardless (it is a latent foot-gun: the
  current working branch `feat/follow-105-1a-sdk-audit` is itself an example of a branch that gets no push
  CI). If a second branch-naming/CI-trigger incident occurs, promote a Rule: "all working branches MUST use
  an agent prefix (`<agent>/<ticket>-...`); CI push-trigger allowlists only those prefixes by design — a
  `feat/`/`fix/` branch will run zero CI until a PR-to-main is opened."

### 7. Follow-ups

- **FOLLOW-110** (P2, backend-engineer, 1.5h, Sprint 14): log `adapt_decision_id` on the POST skip +
  holdout arms (call `logDecisionAsync` with the held-out/skip context) so every returned id has a
  correlatable `adaptation_decisions` row. Closes LG-1. Sequence before/with FOLLOW-108.
- **FOLLOW-111** (P2, devops-engineer + backend-engineer, 2h, Sprint 14): wire the Worker `/api/adapt` 410
  `console.warn` to a structured, queryable sink (Cloudflare Workers Logpush or a Sentry metric) and define
  the 7-day zero-traffic query + threshold that FOLLOW-107 retirement depends on. Closes LG-3; prerequisite
  for FOLLOW-107.
- **FOLLOW-112** (P2, qa-engineer + sdk-engineer, 1.5h, Sprint 14): live-contract test — feed an actual
  control-plane `/api/adapt` response (real route handler, mocked DB) through `adaptResponseSchema.parse()`
  to prove value-level (not just structural) conformance. Closes TG-2.
- **FOLLOW-113** (P2, devops-engineer, 1h, Sprint 14): harden the `ci.yml` trigger so off-convention
  branches do not silently run zero CI — either add a `branches: ['**']` push trigger with path filters, or
  a lightweight `pre-push` / repo-policy check that fails fast on a non-agent-prefixed branch with a clear
  "rename to `<agent>/...` to get CI" message. Closes the ESC-011 process gap.
- **Note (no stub):** PM should (a) add an AC to **FOLLOW-107** enumerating the orphaned decision-api lib
  files + the ADR-0006 host-string correction, and set `depends_on: [FOLLOW-111]`; (b) confirm **FOLLOW-106**
  targets the control-plane route (not the 410 Worker); (c) add a `data-decision-url` AC to
  **TICKET-PILOT-001** (§5a); (d) fold DG-2 into the FOLLOW-071 SDK-config-surface doc sweep.

### 8. Cross-references

- **RETRO-001 (TICKET-046, Rule G origin):** RETRO-010 §4c TG-1 is the next instance of the Rule G class
  (breaking required-field change → mock sweep), in a new sub-form (out-of-typesystem string/JSON/E2E
  fixtures that `pnpm typecheck` cannot catch). Tracked as a Rule G amendment candidate (§6, threshold not
  met).
- **RETRO-009 (TICKET-PILOT-004):** Same SDK init / "manual pilot install must wire config the
  wizard+tests exercise but the hand install does not" cascade onto TICKET-PILOT-001. RETRO-009's FOLLOW-097
  (inquiry-selector threading) and RETRO-010's §5a `data-decision-url` AC are sibling PILOT-001
  prerequisites — PM should bundle them into the PILOT-001 readiness checklist. RETRO-009 DG-1 and
  RETRO-010 DG-2 are the same SDK-config-surface documentation gap (FOLLOW-071 family).
- **RETRO-002 / RETRO-003 (Rule H origin) + Rule H amendment (2026-05-25):** This PR SHIPPED the Rule H
  amendment it is governed by (adapt schema-drift gate + Worker 410/no-archetype-selection gate). The
  amendment held: the Worker route is 410, the SDK schema field-set equals `AdaptationDirectives`, and
  `check-adapt-schema-drift` + `check-rule-h.sh` enforce both in the `rule-h` CI lane. The decision-api lib
  orphaning is a known Rule I red owned by FOLLOW-107 (not a new violation introduced here).
- **RETRO-007 (Sprint 11):** §3 HALF_WIRE_P disposition for the `adapt_decision_id` ClickHouse column
  mirrors RETRO-007's `dsr_audit_log.clickhouse_mutation_status` "written-for-future-read audit artifact"
  P3 accept-no-FOLLOW reasoning.

### 9. Rule promotion

**No new Rule promotion this retro.** Two candidate patterns surfaced (§6), both at count 1 (threshold 2
not met):

1. **Rule G out-of-typesystem-fixture amendment** — count 1 (RETRO-010). Rule G's TS-inline-mock case is
   from RETRO-001; the string/JSON/E2E-fixture sub-case is new this retro. Track; promote a Rule G
   amendment if FOLLOW-109's Zod rollout reproduces it.
2. **CI-trigger branch-prefix allowlist (ESC-011)** — count 1 (RETRO-010, first in corpus). Track; promote
   a branch-naming rule if a second incident occurs. FOLLOW-113 hardens it structurally regardless.

The **Rule H amendment (2026-05-25)** that this PR ships is itself the codification of the FOLLOW-105
finding class — it was authored as part of this work (≥2-retro threshold satisfied by the ADR-0004/0006
+ substep-1a-audit evidence chain), so no further rule is needed for the canonical-adapt-drift pattern.

### 10. Cross-references summary (for PM-orchestrator)

Related to RETRO-001 (Rule G), RETRO-002/003 (Rule H + amendment shipped here), RETRO-007 (audit-column
HALF_WIRE_P disposition), RETRO-009 (PILOT-001 manual-install config cascade + FOLLOW-071 doc-surface gap).

---

## RETRO-011 — FOLLOW-097 (thread inquiry_submit_selector into setupObservers at init) — 2026-05-26

### 1. Summary of change

- **PR:** #151 (merged 2026-05-25 22:38 UTC / 2026-05-26 00:38 +0200, commit `3cf05ee`; squash of 2
  commits — the core fix + an e2e-fixture navigation fix)
- **Files changed:** 6 (+350 / −82). Net logic delta is tiny; the −82/+94 in `index.ts` is almost
  entirely a re-indent of the existing `setupObservers` callback body, not behavior change.
- **Modules touched:** SDK (`packages/sdk`) only — `src/core/config.ts`, `src/index.ts`, plus tests
  (`__tests__/config.test.ts`, `e2e/inquiry-observer.spec.ts`, `e2e/fixtures/inquiry.html`,
  `e2e/serve.js`). No control-plane / ingest / decision-api / shared / data-engine code touched.
- **Key contracts changed:**
  - `SdkConfig.inquirySubmitSelector?: string` (`packages/sdk/src/core/config.ts:38`) — **added,
    optional** — breaking: no.
  - `readConfig()` now reads `data-inquiry-submit-selector` off the script dataset
    (`config.ts:98`, conditional-spread per `exactOptionalPropertyTypes`) — additive — breaking: no.
  - `setupObservers(config, onEvent, options)` call site (`index.ts:357-365`) — now passes the 3rd
    `options` arg `{ inquirySubmitSelector }` (built conditionally) — **this is the fix**; the
    `ObserverOptions` / `setupObservers` signatures themselves are unchanged from RETRO-009 (PR #144).
  - `e2e/serve.js` — routes top-level `*.html` to `e2e/fixtures/` — test infra — breaking: no.

### 2. Verification done in PR

- Test files changed: `config.test.ts` (+2 unit tests: reads selector from dataset; omits field when
  attribute absent), `inquiry-observer.spec.ts` (new Playwright spec, 4 tests: init-without-error,
  `inquiry.started` fires on submit click, `form_variant: contact_v2` payload + decoy-button non-fire,
  SPA race — button injected after init still fires via the delegated `document` click listener),
  `inquiry.html` (new fixture), `serve.js` (fixture routing).
- Assertions added: ~15 (2 unit + ~13 across the 4 e2e tests).
- Coverage delta: positive on `config.ts` (new field read + fallback both covered). **Crucially, this
  PR closes RETRO-009 TG-1** — `inquiry-observer.spec.ts` drives the REAL SDK init path (script tag →
  `readConfig` → `setupObservers` options), so the production wire that the RETRO-009 unit test could
  not reach (it injected the selector directly into `setupObservers`) is now exercised end-to-end.
- CI checks: passed at merge per QUEUE.md (PR #151 on `3cf05ee`, all real Lane A merge gates green;
  pre-existing-red Rule I / Vercel / Python lanes non-blocking per QUEUE.md preamble). The 2nd commit
  (`onsubmit="return false"` on the fixture form) fixed 2 e2e tests that were red because a `type=submit`
  button in an action-less form triggered a real navigation, tearing down the in-memory event queue
  before the 5s batch flush — a fixture defect, not an SDK defect.
- **SDK-internal wire verdict:** the `data-inquiry-submit-selector` → `SdkConfig.inquirySubmitSelector`
  → `setupObservers(options)` → `onInquirySubmitClick` listener chain is now COMPLETE and tested. The
  RETRO-008/009 HALF_WIRE_P (options arg omitted at the sole call site) is **resolved at the SDK layer.**
  See §3 for the residual one-hop-downstream half-wire this surfaced.

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- `SdkConfig.inquirySubmitSelector` (new field) — consumed by `index.ts:362-363` (read into the
  `setupObservers` options) → `observer.ts:146` (`options.inquirySubmitSelector`). Non-test consumer
  present. **Clean.**
- `readConfig` change — `readConfig` is called at `index.ts:79` (SDK init). **Clean.**
- `e2e/serve.js` fixture routing — invoked by the Playwright webServer config. Test infra,
  framework-discovered. **Clean.**
- No new files with zero non-test importers. **CHECK A clean.**

**CHECK B — Half-wire detection:**

- **HALF_WIRE_C** — `script_attribute:data-inquiry-submit-selector` (equivalently
  `SdkConfig.inquirySubmitSelector`) — **the SDK consumer now exists with NO production producer of
  the attribute.** This PR correctly wires the *consumer* side (the SDK reads
  `script.dataset.inquirySubmitSelector` and registers the click observer when present), but NO
  production code path ever emits `data-inquiry-submit-selector` onto the SDK `<script>` tag. Searches:
  - Consumer: `packages/sdk/src/core/config.ts:98` reads it; `index.ts:362` threads it;
    `observer.ts:146` registers the listener. ✅ present.
  - Producer: `grep -rn 'data-inquiry-submit-selector' apps/ packages/ --include=*.ts --include=*.tsx
    --include=*.svelte` filtered to non-test, non-e2e, non-comment lines returns **ZERO matches**. The
    onboarding-wizard snippet generator `buildSnippet(tenantId, apiKey)`
    (`apps/control-plane/src/components/onboarding/DetectionPreview.tsx:115`) emits only
    `data-tenant-id`, `data-api-key`, `data-decision-url` — NOT the inquiry selector. The demo mockup
    `apps/control-plane/src/app/dashboard/demo/mockup/layout.tsx:38` likewise omits it. And
    `grep inquiry_submit_selector apps/control-plane` returns **zero** — the detected
    `inquiry_submit_selector` (present in the schema fixture
    `auto-detect/__fixtures__/000-app-estalara/detail-ground-truth.json:19` and persisted to the
    `tenant_site_schemas.schema` JSONB by the activation route) is **never read out into any snippet or
    rendered `<script>` tag.**

  Net effect: after FOLLOW-097, `inquiry.started` fires in unit tests AND in the new e2e fixture
  (which hand-writes the attribute), but **still never fires for a real onboarded tenant**, because the
  attribute that the now-correct SDK consumer depends on is emitted by nobody. The half-wire that
  RETRO-009 located at the SDK init call site has simply **moved one hop downstream** to the
  schema→snippet link. A consumer expecting data that never arrives → **HALF_WIRE_C, priority P0**
  (per the agent-spec rationale: a consumer reading config that no producer sets is silently broken at
  runtime — here, silently zero `inquiry.started` events in production, exactly the RETRO-009 symptom
  the ticket set out to cure). → **FOLLOW-114**.

  Severity nuance: this does NOT crash (the SDK `if (inquirySubmitSelector && ...)` guard simply skips
  registration when the field is absent, and the downstream `/api/pilot/inquiry-starts` route falls
  back to mock data). So nothing throws — but the *business* consequence is identical to the original
  bug: the secondary pilot metric reads empty/mock forever unless the producer link is built. P0 is
  assigned because TICKET-PILOT-001 (the pilot launch) depends on FOLLOW-097 and would otherwise ship
  believing the inquiry wire is closed when it is not.

- **No other new event type / env var / DB column / topic** introduced by this PR. CHECK B otherwise
  clean.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P0, central) — the schema→snippet producer link is missing (see §3 HALF_WIRE_C).** Two
  concrete sub-paths both lack it: (a) the **wizard** path — `buildSnippet()` must read the activated
  tenant's `tenant_site_schemas.schema.inquiry_submit_selector` and emit
  `data-inquiry-submit-selector="<sel>"` when present; (b) the **manual pilot install** path
  (TICKET-PILOT-001's SvelteKit `+layout.svelte`) must hand-write the same attribute. Neither exists.
  → **FOLLOW-114** (covers the wizard/generator side) + an explicit PILOT-001 AC (§5a) for the manual
  side. This is the **third instance** of the "manual/generated install must wire SDK config that the
  wizard + tests exercise but the real install path does not" class (RETRO-009 LG-1 inquiry-selector;
  RETRO-010 §5a `data-decision-url`). See §6.
- **LG-2 (P3) — `payload.form_variant` is still hardcoded `'contact_v2'`** (`observer.ts:158`),
  unchanged by this PR. Already flagged as RETRO-009 LG-2 (acceptable for a single-form pilot; would
  mislabel inquiries for multi-form tenants). No new action — folded reference only; the original
  post-pilot disposition stands.

#### 4b. Code bugs not caught

- **CB-1 (P3, test-infra, already fixed in-PR) — the e2e fixture's submit button triggered a real
  navigation.** A `type=submit` button inside an action-less `<form>` reloaded the page on click,
  tearing down the event queue before the 5s flush; 2 e2e tests went red and were fixed by adding
  `onsubmit="return false"` to the fixture (2nd commit). Recorded because it is a recurring e2e-fixture
  foot-gun (navigation resets in-memory SDK state), not because it is open. The SDK itself correctly
  does NOT call `preventDefault` (it must never block a tenant's real inquiry form); production
  navigation is covered by the `beforeunload` keepalive flush. No FOLLOW.
- **CB-2 (none functional).** No functional defect introduced by the SDK change.

#### 4c. Test coverage gaps

- **TG-1 (P1) — there is no test that the PRODUCED snippet carries `data-inquiry-submit-selector`.**
  The e2e fixture hand-writes the attribute, so the e2e suite proves "IF the attribute is present, the
  SDK fires" — but nothing asserts that any production generator (`buildSnippet`, the activation flow,
  or the PILOT-001 layout) actually emits it. This is exactly why the §3 HALF_WIRE_C is invisible to
  the green CI on this PR: the test substitutes for the missing producer. A `buildSnippet` unit test
  asserting the attribute is emitted when the activated schema carries the selector would have surfaced
  LG-1. → folded into **FOLLOW-114** AC. (Direct structural parallel to RETRO-010 §4c TG-1 / RETRO-009
  TG-1: "the test injects the value the production path omits.")
- **TG-2 (P2) — no contract test pins the SDK-emitted `inquiry.started` payload to
  `InquiryStartedEventSchema` from `@estalara/shared`.** RETRO-009 TG-2 folded this into FOLLOW-097's
  AC, but the merged PR did not add it (the e2e asserts `form_variant: contact_v2` against a literal,
  not against the Zod schema). Still currently safe (`form_variant` is `z.string().optional()`), but
  the drift guard RETRO-009 asked for was not delivered. → **FOLLOW-115** (P2).

#### 4d. Documentation gaps

- **DG-1 (P3) — `inquirySubmitSelector` / `data-inquiry-submit-selector` is still absent from the
  Master Design §B.1 SDK-config-surface table** (and the SDK install/snippet docs). Same omission class
  as RETRO-009 DG-1 (`ObserverOptions`), RETRO-010 DG-2 (`data-decision-url` convention), FOLLOW-071
  family. Master Design changelog v3.1 *narrates* the FOLLOW-097 fix but the config-surface table is not
  updated. → fold into the FOLLOW-071 SDK-config-surface doc sweep (no new stub).

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13b Lane B, BLOCKED, `depends_on` includes FOLLOW-097) — MOST AFFECTED.**
  PILOT-001 lists FOLLOW-097 as a dependency precisely to close the inquiry wire, but per §3 the wire is
  only half-closed: the SDK reads the attribute, nobody emits it. PILOT-001's manual SvelteKit
  `+layout.svelte` install will install the SDK and the secondary pilot metric (`inquiry.started` →
  `/api/pilot/inquiry-starts`) will read empty/mock unless the install hand-writes
  `data-inquiry-submit-selector="<selector from 000-app-estalara schema>"`. **PM action: add an explicit
  AC to PILOT-001** — symmetric to the RETRO-010 `data-decision-url` AC already added — requiring the
  `+layout.svelte` snippet to emit `data-inquiry-submit-selector` (value from the activated
  `000-app-estalara` schema, `"[data-estalara-slot='inquiry-submit']"`) AND a shadow-mode smoke
  assertion that `inquiry.started` rows land in ClickHouse for the pilot tenant. This pairs with the
  existing RETRO-010 `data-decision-url` AC — both are the same "manual install must wire config the
  wizard+tests exercise" cascade.
- **TICKET-PILOT-002 (go/no-go runbook, BLOCKED) — the runbook's "inquiry.started observed in
  ClickHouse during shadow mode" check (added by RETRO-009 §5a) is now MORE load-bearing**, because it
  is the only gate that would catch the §3 HALF_WIRE_C before go-live. Confirm it is in the runbook.
- **Wave 3 (FOLLOW-094 / FOLLOW-098 / FOLLOW-093, all READY) — not affected by this SDK change.** They
  touch the pilot dashboard routes (control-plane), not the SDK. FOLLOW-098 (inquiry-starts fail-loud +
  provenance) is *thematically* linked: once it ships, a dashboard showing mock inquiry data will at
  least be labeled as mock — which would make the §3 half-wire visible to a human at go/no-go (a
  defense-in-depth mitigation, not a fix). No spec change to Wave 3.

#### 5b. Future sprint tickets affected

- **FOLLOW-091 (inquiry-starts mock → real):** still COUPLED to the inquiry producer chain (RETRO-009
  §5b). Now precisely blocked: replacing the mock is pointless until FOLLOW-114 closes the schema→snippet
  producer link AND PILOT-001 emits the attribute. FOLLOW-091's precondition should read "FOLLOW-097 +
  FOLLOW-114 shipped and `inquiry.started` rows present in ClickHouse for the pilot tenant."
- **FOLLOW-114 (this retro):** the producer-side completion of FOLLOW-097; should land before
  TICKET-PILOT-001 go-live (or PILOT-001 must absorb the manual-install half).

#### 5c. Contracts changed that other modules rely on

- `SdkConfig` gained an optional field — backward compatible; no existing consumer relied on a changed
  contract. The `setupObservers` signature is unchanged (the 3rd param was already added in PR #144).
- `inquiry.started` was already a registered `@estalara/shared` event (`events/index.ts` EVENT_TYPES,
  `events/inquiry.ts` schema) and is already consumed by `cta-lift/route.ts` (funnel stage) and
  `inquiry-starts/route.ts`. Ingest validation + downstream consumers were ready before this PR — only
  the SDK→attribute producer wire (now §3 HALF_WIRE_C) remains.

#### 5d. Architectural assumptions affected

- **Master Design §B.9 (Tier 3 Native, detected-schema-drives-runtime-SDK-behavior assumption):**
  RETRO-009 §5d noted this assumption was "only partially realized" because the SDK consumed no
  per-tenant schema selectors. After FOLLOW-097 the SDK *can* consume the inquiry selector — but the
  detection→activation→snippet pipeline still does not surface ANY detected selector onto the rendered
  `<script>` tag (verified: `inquiry_submit_selector` is persisted to `tenant_site_schemas.schema` but
  never read back into a snippet). So the assumption remains only partially realized: the **runtime
  consumer** is built, the **schema→runtime producer** is not. FOLLOW-114 is the first ticket that
  would actually close that loop for one selector. No Master Design edit beyond DG-1's config-surface
  table.

### 6. New lesson candidates

- **Pattern — "A manually-written or generated install/snippet path must wire an SDK config value that
  the unit/e2e tests and the wizard exercise, but the real install path omits — so the feature passes
  CI yet is dead in production."** This is the dominant finding of this retro (§3 / §4a LG-1 / §4c
  TG-1). Occurrences:
  - RETRO-009 LG-1 — `inquiry_submit_selector` not threaded into `setupObservers` at init (the SDK call
    site); test injected it directly.
  - RETRO-010 §5a / TICKET-PILOT-001 AC — `data-decision-url` not emitted by the manual `+layout.svelte`
    install (the wizard `buildSnippet` fix did not cover the manual path).
  - RETRO-011 (this) — `data-inquiry-submit-selector` not emitted by ANY snippet generator; e2e fixture
    hand-writes it.
  - **Count: 3 distinct retros (009, 010, 011). THRESHOLD (2) MET.** All three are the same root failure
    mode: **the test/fixture supplies the very config the production install path omits, so green CI
    masks a dead wire.** This is adjacent to but NOT covered by existing rules: Rule H is "schema
    scaffold must ship a runtime-wired consumer" (consumer side); Rule I's CI gate catches zero-importer
    symbols but NOT a config field that IS imported yet is never *produced* by an install path; Rule G is
    about breaking-type mock sweeps. The distinct, now-thrice-seen element is **"verify the production
    producer emits the value, not just that the consumer reads it — a test that injects the value is not
    evidence the install path supplies it."** → **PROMOTED as Rule L** (see §9).
- **Pattern — e2e fixture navigation tears down in-memory SDK state (CB-1).** Count: 1 (this retro).
  Threshold not met. Track; if a second e2e flush-vs-navigation flake occurs, codify "e2e inquiry/form
  fixtures must `return false` / `preventDefault` on submit so the batch flush completes in-document."

### 7. Follow-ups

- **FOLLOW-114** (P0, backend-engineer + sdk-engineer, 2h, Sprint 13b — before TICKET-PILOT-001
  go-live): close the schema→snippet producer link for `inquiry_submit_selector`. Make `buildSnippet`
  (and any other rendered SDK `<script>` generator) read the activated tenant's
  `tenant_site_schemas.schema.inquiry_submit_selector` and emit `data-inquiry-submit-selector="<sel>"`
  when present; add a `buildSnippet` unit test asserting the attribute is emitted (closes §3 HALF_WIRE_C
  + §4a LG-1 + §4c TG-1). Coordinate with the TICKET-PILOT-001 manual-install AC (§5a) so both the
  wizard and the SvelteKit paths emit it.
- **FOLLOW-115** (P2, qa-engineer + sdk-engineer, 1h, Sprint 14): contract test pinning the SDK-emitted
  `inquiry.started` payload to `InquiryStartedEventSchema` from `@estalara/shared` (RETRO-009 TG-2 was
  folded into FOLLOW-097 but not delivered; carry it forward). Closes §4c TG-2.
- **Note (no stub):** PM should (a) add a `data-inquiry-submit-selector` AC to **TICKET-PILOT-001**
  (§5a), symmetric to the existing RETRO-010 `data-decision-url` AC; (b) fold DG-1 into the FOLLOW-071
  SDK-config-surface doc sweep; (c) update **FOLLOW-091**'s precondition to require FOLLOW-114 (§5b).

### 8. Cross-references

- **RETRO-008 / RETRO-009 (the bug this PR fixes):** FOLLOW-097 resolves the RETRO-009 HALF_WIRE_P
  (options arg omitted at the `setupObservers` call site) and closes RETRO-009 TG-1 (production-path
  e2e). RETRO-009 TG-2 (Zod contract test) was folded into FOLLOW-097's AC but NOT delivered → carried
  forward as FOLLOW-115. RETRO-009 LG-2 (`form_variant` hardcode) is unchanged → §4a LG-2.
- **RETRO-010 (FOLLOW-105 Wave 1, sibling Wave-2 ticket on the same SDK init path):** RETRO-010 §5a
  explicitly predicted this — "the manual pilot install must wire SDK config that the wizard/tests
  exercise but the hand-written install does not," pairing the `data-decision-url` gap with the
  FOLLOW-097 inquiry-selector threading. RETRO-011 confirms the prediction one level deeper: even with
  FOLLOW-097 merged, the attribute producer is absent. The two `TICKET-PILOT-001` ACs
  (`data-decision-url` + `data-inquiry-submit-selector`) are siblings — bundle into the PILOT-001
  readiness checklist. RETRO-010 DG-2 + RETRO-011 DG-1 are the same FOLLOW-071 config-surface doc gap.
- **Rule H / Rule I lineage (RETRO-002/003):** §3 HALF_WIRE_C is the next instance — a config field that
  IS imported/consumed (so Rule I's zero-importer CI gate does NOT fire) yet has NO production producer.
  Rule L (§9) extends the half-wire family to cover the producer-absence sub-case for install/snippet
  paths.

### 9. Rule promotion

**One new Rule promoted — Rule L** (the "manual/generated install must produce the config its consumer
reads" pattern, seen in RETRO-009, RETRO-010, RETRO-011 — count 3, threshold 2 met). Appended to
`CONVENTIONS_PATCH.md`. The FOLLOW-115 (Zod-contract) and e2e-navigation patterns remain at count 1 —
NOT promoted.

### 10. Cross-references summary (for PM-orchestrator)

Related to RETRO-008/009 (bug origin — HALF_WIRE_P now resolved at SDK layer, moved downstream to a
HALF_WIRE_C producer gap), RETRO-010 (sibling Wave-2 SDK-init / manual-install cascade — prediction
confirmed), RETRO-002/003 (Rule H/I half-wire lineage; Rule L promoted here). New follow-ups:
FOLLOW-114 (P0), FOLLOW-115 (P2).

---

## RETRO-012 — FOLLOW-106 (tenants.pilot_frozen runtime flag + Lane C measurement-window warning) — 2026-05-26

### 1. Summary of change

- **PR:** #152 (merged 2026-05-25 22:38 UTC / 2026-05-26 00:38 +0200, commit `b83e6c0`)
- **Files changed:** 6 (+215 / −0). All additive; zero deletions.
- **Modules touched:** control-plane (`apps/control-plane/src/app/api/adapt/route.ts`), shared DB
  package (`packages/db` — schema + migration + journal), docs (`docs/ops/PILOT_FREEZE_RULE.md`),
  backlog (`backlog/sprint-12/TICKET-PILOT-001.md` authored). **No SDK / ingest / decision-api /
  data-engine code touched.**
- **Key contracts changed:**
  - `tenants.pilotFrozen` (`packages/db/src/schema/tenants.ts:56`) — `boolean('pilot_frozen').notNull().default(false)`
    — **added** — breaking: no (defaulted column, inherits existing `tenant_isolation` RLS, no new policy).
  - Migration `packages/db/migrations/0015_pilot_frozen.sql` — `ALTER TABLE tenants ADD COLUMN IF NOT
    EXISTS pilot_frozen boolean NOT NULL DEFAULT false` (idempotent, forward-only) — additive.
  - `LANE_C_FLAG_KEYS` const + `checkPilotFrozenAsync(tenantId, requestId)` function
    (`adapt/route.ts:78,99`) — **new, module-private** (not exported) — breaking: no.
  - `GET /api/adapt` + `POST /api/adapt` — gained a fire-and-forget `checkPilotFrozenAsync(...)` call;
    response contract **unchanged** (warning is observability-only, never alters the body) — breaking: no.
  - Structured log event `pilot_frozen_lane_c_active` (`console.warn` JSON) — new observability signal.
  - `TICKET-PILOT-001.md` authored under `backlog/sprint-12/` (was absent per QUEUE.md note); AC §5/§DoD
    includes setting `pilot_frozen=true` on the shadow→live flip.

### 2. Verification done in PR

- Test files changed: **none.** No unit test was added for `checkPilotFrozenAsync()` or the
  `LANE_C_FLAG_KEYS` filter logic.
- Assertions added: **0.**
- Coverage delta: **negative** for the control-plane adapt route — net-new branch logic (pilot-frozen
  read + Lane C flag filter + warn) shipped with zero direct test. The control-plane `apps/*` ≥70% bar
  is not measured per-function, but this is an explicit gap (see §4c TG-1).
- CI checks: green at merge on all real Lane A merge gates per QUEUE.md (`b83e6c0`); pre-existing-red
  Rule I / Vercel Preview / Python lanes non-blocking per QUEUE.md preamble. **No migration was run in
  CI** (no DB creds in sandbox; `IF NOT EXISTS` makes it idempotent). Local typecheck `@estalara/db` +
  `@estalara/control-plane` reported PASS by the implementing agent (per PR body) — not independently
  re-verified here.

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- `tenants.pilotFrozen` (new Drizzle column) — consumed by `adapt/route.ts:108` (`select({ pilotFrozen:
  tenants.pilotFrozen })`) and read at `:116` (`row?.pilotFrozen`). Non-test consumer present. **Clean.**
- `checkPilotFrozenAsync` (new module-private fn) — invoked at `adapt/route.ts:593` (GET arm) and `:665`
  (POST arm). Two non-test call sites. **Clean.**
- `LANE_C_FLAG_KEYS` (new const) — consumed by `checkPilotFrozenAsync` at `:120` (`.filter(...)`).
  **Clean.**
- Migration `0015_pilot_frozen.sql` + `_journal.json` idx-15 entry — discovered by the drizzle migrator
  (`packages/db/scripts/migrate.ts`), config/framework-driven, not import-reached. **Clean** (false-positive
  class suppressed). No new exported symbol, no new file with zero non-test importers. **CHECK A clean.**

**CHECK B — Half-wire detection:**

- **HALF_WIRE_C** — `quizConfig_flag:{lane_c_active, intent_engine_enabled, quiz_enabled,
  shadow_mode_override}` — the four `LANE_C_FLAG_KEYS` are **consumed** by `checkPilotFrozenAsync`
  (`adapt/route.ts:120` filters `cfg[key] === true` out of `tenants.quizConfig`) but **NO producer ever
  writes any of these keys into `quizConfig`.** Searches:
  - Consumer: `adapt/route.ts:78-81` (the const) + `:120` (the filter). ✅ present.
  - Producer: the sole writer of `tenants.quizConfig` is `apps/control-plane/src/app/api/quiz/config/route.ts`
    (POST handler), whose `QuizConfigSchema` accepts ONLY `enabled`, `trigger_after_n_listings`,
    `sticky_widget`, `language`, `accent_color` — **none of the four Lane C flag keys.** A repo grep for
    `lane_c_active` / `intent_engine_enabled` / `quiz_enabled` / `shadow_mode_override` as written values
    (outside `adapt/route.ts` itself) returns **zero producers.** `quiz_enabled` is conceptually adjacent
    to the quiz-config `enabled` field but is a DIFFERENT key (the warning checks `cfg.quiz_enabled`, the
    quiz route writes `cfg.enabled`) — so even the one plausibly-existing flag is not actually produced
    under the key the consumer reads.
  - Net effect: `checkPilotFrozenAsync` will, for the foreseeable future, find `activeFlags.length === 0`
    on every call and **never emit the `pilot_frozen_lane_c_active` warning** — even if a Lane C feature
    IS active — because the feature-on state is recorded under different keys (or not in `quizConfig` at
    all). The guardrail is wired consumer-side only.
  - **Severity disposition: P2 (NOT the spec-default P0 for HALF_WIRE_C).** The agent-spec assigns P0 to
    HALF_WIRE_C because "a consumer expecting data that never arrives is silently broken at runtime (NPE,
    undefined branch, missing config at boot)." Here the consumer is **defensively null-safe by design**:
    `cfg[key] === true` treats absent/undefined as inactive (the JSDoc explicitly documents "unknown =
    inactive = safe"), the whole function is fire-and-forget and try/caught, and it **cannot break the
    adapt response.** Nothing throws; no branch goes undefined. The failure mode is a **silently-inert
    safety net**, not a runtime break — the same business-consequence class as RETRO-011's HALF_WIRE_C
    but without the runtime-fragility that motivates P0. It is downgraded to P2 because (a) it breaks
    nothing, and (b) the keys are forward-looking placeholders for FOLLOW-087/100/101/102 features that
    have not landed — by intent the producers do not exist yet. The risk is **false reassurance**: an
    operator at go/no-go may believe the measurement-window guard is armed when it is silently disarmed.
    → **FOLLOW-117** (P2): align the consumer keys with real producers (or document the contract the Lane
    C implementers must honor) + add a test proving the warning fires when a flag is set.
- **No new event type, env var, Redpanda topic, or SDK signal** introduced. The new DB column
  (`pilot_frozen`) is fully wired (producer = TICKET-PILOT-001 manual `UPDATE` per spec §5 / consumer =
  `checkPilotFrozenAsync`); its producer is a documented human/operator action, not code, which is the
  intended design (PILOT_FREEZE_RULE.md Decision 3) — **not a half-wire** (analogous to RETRO-010's
  operator-set disposition).

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P2, central) — the Lane C warning's flag keys have no producers (see §3 HALF_WIRE_C).** The
  guardrail is consumer-only; `quiz_enabled` (read) vs `enabled` (the key the quiz route actually writes)
  is a concrete key-mismatch even for the one Lane C feature that exists today. → FOLLOW-117.
- **LG-2 (P3) — dev/stg schema drift: migration 0015 applied to prd only.** Per the QUEUE.md FOLLOW-106
  notes + this task's context, `0015_pilot_frozen.sql` was applied to **prd** but NOT **dev** or **stg**
  because `DATABASE_URL_ADMIN` is unset in Doppler for those configs (no admin DB creds; same root cause
  as RETRO-006/007 Doppler-credential findings). Judged not a pilot blocker (pilot runs against prd) —
  correct. But the drift is now real: `tenants` in dev/stg lacks `pilot_frozen` while the Drizzle schema
  (`tenants.ts`) and any code/test that `select`s `tenants.pilotFrozen` assumes it exists. Cascading risk
  is bounded today (the only reader is `checkPilotFrozenAsync`, which is try/caught and would log
  `pilot_frozen check failed` rather than crash on an "undefined column" Postgres error against dev/stg)
  — but (i) a future migration with `idx > 15` applied to dev/stg will replay 0015 first (idempotent
  `IF NOT EXISTS` makes that safe), and (ii) any future integration test or local-dev flow pointed at
  dev/stg that reads `pilot_frozen` will hit a Postgres `column does not exist` error. → **FOLLOW-116**
  (backfill dev/stg once `DATABASE_URL_ADMIN` is provisioned; tracks with ESC-010).
- **LG-3 (P3) — migration journal timestamp regression.** `_journal.json` idx-15 carries
  `"when": 1748304000000` (≈ 2025-05-27), which is EARLIER than idx-14's `1779840000000` (≈ 2026). Drizzle
  orders migrations by `idx`, so the apply order is correct and this is not a functional bug (the PR body
  flagged it as advisory #3). But a backdated `when` is a latent foot-gun for any tooling that sorts or
  reports migrations chronologically, and for human readers diffing the journal. Cosmetic, forward-only
  migration already merged — **no FOLLOW** (a journal rewrite of a merged migration is riskier than the
  cosmetic defect); noted for awareness. If a future migration tool relies on `when`, revisit.

#### 4b. Code bugs not caught

- **CB-1 (P2) — per-request tenant SELECT added to the hot adapt path with no caching.**
  `checkPilotFrozenAsync` issues a fresh `createAdminClient()` + `SELECT pilot_frozen, quiz_config FROM
  tenants WHERE id=...` on **every** GET and POST `/api/adapt` call. It is fire-and-forget so it does not
  add to the p95 response latency budget (<100ms) on the critical path, and it mirrors the existing
  `logDecisionAsync` fire-and-forget pattern — but it is an **extra DB round-trip + connection per adapt
  request** for a value (`pilot_frozen`) that changes at most once per pilot (the shadow→live flip). On a
  high-traffic tenant this is wasted DB load every request to read a near-constant flag. The PR body
  itself flagged this as advisory #2. Not a correctness bug; an efficiency/scaling concern. → folded into
  FOLLOW-117 as an optional AC (cache the tenant flag, e.g. short-TTL in-memory or Upstash) rather than a
  separate stub.
- **CB-2 (none functional).** The fire-and-forget `void (async () => {...})()` is correctly try/caught
  and cannot reject unhandled; `createAdminClient()` throwing (e.g. dev/stg missing creds) is caught and
  logged. No unhandled-rejection or response-blocking defect.

#### 4c. Test coverage gaps

- **TG-1 (P2) — zero tests for `checkPilotFrozenAsync` / the Lane C flag filter.** Net-new branch logic
  (pilot_frozen read → flag filter → structured warn) shipped with no unit test. The warning's exact
  trigger condition (`pilot_frozen=true` AND ≥1 flag `=== true`), the absent=safe behavior, the
  `tenantId==='unknown'` short-circuit, and the DB-error swallow are all unverified. A test that mocks
  `createAdminClient` to return `{ pilotFrozen: true, quizConfig: { quiz_enabled: true } }` and asserts a
  `pilot_frozen_lane_c_active` warn fires would BOTH cover this logic AND surface the §3 HALF_WIRE_C (it
  would force the author to confront which key a real producer sets). → folded into **FOLLOW-117** AC.
  (Same structural parallel as RETRO-011 TG-1 / RETRO-010 TG-1: "a test would have surfaced the dead
  producer wire.")

#### 4d. Documentation gaps

- **DG-1 (P3) — `tenants.pilot_frozen` is well-documented in PILOT_FREEZE_RULE.md (this PR added the
  Implementation cross-reference) but the `LANE_C_FLAG_KEYS` → producer contract is NOT documented for
  the Lane C implementers (FOLLOW-087/100/101/102).** The adapt-route JSDoc says "New Lane C flags …
  should be added here as they land," but there is no reciprocal note in the FOLLOW-102 (quiz_enabled) or
  FOLLOW-087/100/101 (intent_engine_enabled) specs telling those implementers they must write the flag
  into `tenants.quizConfig` under the EXACT key the warning reads. Without that, the keys drift (as
  `quiz_enabled` vs `enabled` already shows). → folded into FOLLOW-117 (document the contract) — no
  separate doc stub.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13b Lane B, BLOCKED, `depends_on` includes FOLLOW-106) — DIRECTLY
  AFFECTED.** This PR **authored** PILOT-001's spec file (previously absent) and added the
  `pilot_frozen=true` flip to its AC §5/DoD — so the FOLLOW-106 dependency is now satisfied at the
  schema+route level. **Two carry-forward cautions for PILOT-001 execution:** (1) the flip must run
  `UPDATE tenants SET pilot_frozen=true WHERE id='<pilot-uuid>'` **against prd** (the only env where
  migration 0015 is applied — LG-2); against dev/stg it would error `column does not exist`. (2) Per §3
  HALF_WIRE_C, the `pilot_frozen` guard will **silently never warn** during the measurement window unless
  FOLLOW-117 aligns the Lane C flag producers — so the operator should NOT treat "no
  `pilot_frozen_lane_c_active` log" as evidence that no Lane C feature is active. PM should note this in
  the PILOT-001 / PILOT-002 go/no-go runbook (symmetric to the RETRO-009/011 "inquiry.started observed in
  ClickHouse" check).
- **TICKET-PILOT-002 (go/no-go runbook, BLOCKED):** the runbook should add a manual Lane-C-off
  verification step rather than relying on the (currently inert) `pilot_frozen` warning. Defense-in-depth,
  not a code fix.
- **Wave 3 (FOLLOW-094 / FOLLOW-098 / FOLLOW-093, all READY, Scenario D sequential) — NOT affected by
  this merge.** They touch the pilot dashboard cta-lift + inquiry-starts routes (Rule K.2 fail-loud), not
  the adapt route or the tenants schema. No spec change. (They DO share the broader "pilot measurement
  integrity" theme — FOLLOW-098's provenance work and this retro's pilot_frozen guard are complementary
  layers protecting the same CTA-lift window — but no direct coupling.)

#### 5b. Future sprint tickets affected

- **FOLLOW-102 (quiz_enabled ON/OFF toggle), FOLLOW-087 / FOLLOW-100 / FOLLOW-101 (intent-engine
  toggles):** these are the named-but-unbuilt PRODUCERS for three of the four `LANE_C_FLAG_KEYS`. When
  they land, each implementer MUST write its on-state into `tenants.quizConfig` under the exact key the
  warning reads (`quiz_enabled`, `intent_engine_enabled`) — or extend `LANE_C_FLAG_KEYS` to match the key
  they actually use. FOLLOW-117 should either (a) own this alignment now (documenting the contract) or
  (b) be referenced as a precondition note in each of those specs. **Highest cascade value of this retro.**
- **TICKET-PILOT-001 (covered in §5a)** — the consumer of the `pilot_frozen` write.

#### 5c. Contracts changed that other modules rely on

- `tenants` table gained `pilot_frozen` (Drizzle `pilotFrozen`). Any module doing `SELECT *` or
  constructing a full `tenants` row inline must tolerate the new NOT-NULL-defaulted column (defaulted, so
  inserts that omit it are fine). Verified: the only reader is `adapt/route.ts`; no inline full-row
  `tenants` mock in the repo omits a required field because the column is defaulted. **No Rule G sweep
  needed** (the column is optional-at-insert by virtue of its default).
- `tenants.quizConfig` now has TWO independent readers with DIFFERENT key vocabularies: `quiz/config`
  route (reads `enabled`, etc. — the QuizConfig shape) and `adapt/route.ts` `checkPilotFrozenAsync`
  (reads `lane_c_active`/`intent_engine_enabled`/`quiz_enabled`/`shadow_mode_override`). The JSONB column
  is now an **untyped multi-tenant flag bag with no shared schema** — a drift surface (LG-1/DG-1). Future
  writers/readers of `quizConfig` should converge on a documented key set.

#### 5d. Architectural assumptions affected

- **PILOT_FREEZE_RULE.md Decision 3 (measurement-window protection)** assumed the runtime guard would
  surface Lane-C-active contamination. The guard is **architecturally present but operationally inert**
  until producers exist (§3). The design intent (non-blocking observability) is correctly realized; the
  *coverage* (which flags are actually observable) is the gap. No Master Design edit needed — the
  PILOT_FREEZE_RULE.md Implementation section this PR added is accurate about the mechanism; it should
  gain a one-line caveat (folded into FOLLOW-117) that the flag set is forward-looking.
- **Multi-region / multi-config schema parity** (Master Design infra model assumes dev/stg/prd schemas
  track): LG-2 is a concrete, currently-accepted violation. The accepted-risk rationale (pilot is prd-only)
  is sound for THIS pilot, but the parity assumption is dented until FOLLOW-116 backfills.

### 6. New lesson candidates

- **Pattern — "A consumer-side guard/check reads feature-flag keys from a shared JSONB bag that no
  producer writes (consumer-only half-wire), so the guard is silently inert."** This is §3 / §4a LG-1.
  - Relation to prior retros: this is a **HALF_WIRE_C of the same family** as RETRO-011 (`data-inquiry-
    submit-selector` consumed by the SDK, produced by nobody) and RETRO-009 (`inquirySubmitSelector`
    options arg). RETRO-011 PROMOTED **Rule L** for the install/snippet sub-case ("verify the production
    producer emits the value, not just that the consumer reads it — a test that injects the value is not
    evidence the install path supplies it"). **Rule L already covers this finding conceptually** — the
    FOLLOW-106 Lane C flags are the same "consumer reads config a producer must supply, no producer
    exists, and there is no test forcing the producer to exist" pattern, just in a server-side JSONB-flag
    context rather than an SDK `<script>` attribute context. **No NEW rule needed** — RETRO-012 is a fresh
    Rule L instance (server-side feature-flag variant). FOLLOW-117 is the Rule-L-style remediation
    (align producer + add the test that would have caught it). The system is working as intended: Rule L,
    promoted one retro ago, already names this class.
  - Count of the broad "consumer reads a value no producer sets" class: now 3+ (RETRO-009, 011, 012).
    Rule L holds. The server-side-JSONB-flag sub-form is **count 1** within Rule L — if it recurs (e.g. a
    future flag-bag reader with no writer), consider a Rule L amendment naming JSONB flag bags explicitly.
- **Pattern — "Migration applied to prd but not dev/stg due to missing `DATABASE_URL_ADMIN` in Doppler."**
  Seen in: RETRO-012 (this, schema drift) and is the SAME ROOT CAUSE documented in RETRO-006 / RETRO-007
  (`DATABASE_URL_ADMIN` missing / Doppler credential gaps, lines ~1795/1821 of this file). Count of the
  `DATABASE_URL_ADMIN`-missing root cause: ≥2 across retros. **However this is an ENVIRONMENT/OPS
  provisioning gap (a missing Doppler secret), not a code anti-pattern an agent can be ruled against** —
  there is no grep-able code convention that would prevent it; the fix is "provision the secret"
  (ESC-010 / FOLLOW-116). A CONVENTIONS_PATCH Rule codifies code/process patterns agents control; a
  missing infra credential is not in that class. **No rule promotion** — tracked operationally via
  FOLLOW-116 + ESC-010. (Recorded here so the pattern is visible if it recurs and someone later wants a
  process rule like "every migration PR must record per-config apply status in QUEUE.md" — which FOLLOW-106
  actually DID do well; that good practice could itself be codified if a future migration PR omits it.)

### 7. Follow-ups

- **FOLLOW-116** (P3, devops-engineer + data-engineer, 1h, Sprint 13b/backlog): backfill migration 0015
  (`pilot_frozen`) to dev + stg once `DATABASE_URL_ADMIN` is provisioned in Doppler for those configs
  (tracks with ESC-010). Closes LG-2 / the dev↔stg↔prd schema-parity drift. Low priority — not a pilot
  blocker (pilot is prd-only) — but required before any dev/stg integration test or local-dev flow reads
  `tenants.pilot_frozen`.
- **FOLLOW-117** (P2, backend-engineer, 1.5h, Sprint 13b — before TICKET-PILOT-001 go-live): close the
  Lane C flag-key producer gap (§3 HALF_WIRE_C). Either (a) align `LANE_C_FLAG_KEYS` with the keys real
  producers actually write (today: reconcile `quiz_enabled` vs the quiz route's `enabled`), and/or (b)
  document in the FOLLOW-102 / FOLLOW-087/100/101 specs + PILOT_FREEZE_RULE.md the exact `quizConfig` key
  each Lane C implementer must set; AND add a `checkPilotFrozenAsync` unit test that mocks a frozen tenant
  with an active flag and asserts the `pilot_frozen_lane_c_active` warning fires (closes TG-1). Optional
  AC: cache the per-request `pilot_frozen` lookup to drop the hot-path DB round-trip (CB-1).

### 8. Cross-references

- **RETRO-011 (FOLLOW-097, immediately prior; promoted Rule L):** RETRO-012 §3 HALF_WIRE_C is the next
  instance of the Rule L "consumer reads a value no production producer supplies, and a test injecting the
  value masks the dead wire" class — here server-side (`quizConfig` flag bag) rather than SDK-side
  (`<script>` attribute). Rule L already governs it; FOLLOW-117 is the Rule-L remediation.
- **RETRO-010 (FOLLOW-105 Wave 1):** §5a explicitly predicted FOLLOW-106 must target the **control-plane**
  `/api/adapt` route (not the 410 Worker) and asked the PM to confirm it. **Confirmed resolved:** this PR
  added `checkPilotFrozenAsync` to `apps/control-plane/src/app/api/adapt/route.ts` (the canonical route),
  NOT the decision-api Worker (correctly left as 410). RETRO-010's flag is closed.
- **RETRO-009 / RETRO-008 (pilot measurement integrity):** the `pilot_frozen` guard and FOLLOW-098's
  inquiry-starts fail-loud/provenance work are complementary layers protecting the same CTA-lift
  measurement window; this retro's HALF_WIRE_C means the guard layer is currently inert (FOLLOW-117).
- **RETRO-006 / RETRO-007 (`DATABASE_URL_ADMIN` / Doppler credential gaps):** LG-2's dev/stg drift shares
  their root cause; tracked via FOLLOW-116 + ESC-010 (ops, not a codifiable rule).
- **RETRO-002 / RETRO-003 (Rule H / Rule I half-wire lineage):** §3 HALF_WIRE_C is a config-bag variant
  that Rule I's zero-importer CI gate does NOT catch (the keys ARE referenced — in the consumer) — the
  same Rule-I blind spot RETRO-009/010/011 documented; Rule L is the codified mitigation.

### 9. Rule promotion

**No new Rule promotion this retro.** Two candidate patterns surfaced (§6):

1. **Consumer-only feature-flag half-wire (server-side JSONB bag).** Already covered by **Rule L**
   (promoted by RETRO-011 one retro ago). RETRO-012 is a fresh Rule L instance, not a new rule. The
   server-side-JSONB sub-form is count 1 within Rule L — amend Rule L only if it recurs.
2. **Migration applied to prd but not dev/stg (`DATABASE_URL_ADMIN` missing).** Root cause seen ≥2× (RETRO-
   006/007/012) BUT it is an infra-provisioning gap (a missing Doppler secret), not a code/process
   anti-pattern an agent can be ruled against — no grep-able verification exists. **Not promoted**; tracked
   via FOLLOW-116 + ESC-010. (A future *process* rule — "migration PRs must record per-config apply status"
   — is not warranted because FOLLOW-106 already did this correctly in QUEUE.md.)

The Rule-promotion threshold (2 occurrences of a *codifiable* pattern) is not met for any NEW rule.

### 10. Cross-references summary (for PM-orchestrator)

Related to RETRO-011 (Rule L instance — server-side flag-bag half-wire), RETRO-010 (confirmed FOLLOW-106
correctly targets the control-plane route, not the 410 Worker), RETRO-008/009 (pilot measurement-integrity
layer), RETRO-006/007 (`DATABASE_URL_ADMIN` drift root cause). New follow-ups: FOLLOW-116 (P3, dev/stg
migration backfill), FOLLOW-117 (P2, Lane C flag producer alignment + test). No rule promoted.

---

<!-- NOTE: RETRO-013 through RETRO-018 are appended BELOW this comment (the 6-PR merge-wave
     2026-05-27). The authoritative ledger + next-free-FOLLOW hint lives at the END of this file,
     after RETRO-018. RETRO-019 and beyond should be appended there. -->

## RETRO-013 — FOLLOW-094 (cta-lift route fail-loud on ClickHouse error + data_source provenance) — 2026-05-27

### 1. Summary of change

- **PR:** #153 (merged 2026-05-26 21:58 UTC, commit `9f32aa8`)
- **Files changed:** 3 (+119 / −17)
- **Modules touched:** control-plane (`apps/control-plane` — one pilot API route + its helpers +
  tests). No SDK / ingest / decision-api / shared / data-engine / docs / configs touched.
- **Key contracts changed:**
  - `CtaLiftResponse.data_source: 'clickhouse' | 'mock'` (`route-helpers.ts:75`) — new required
    field — breaking: **yes (additive-required)** — every producer of `CtaLiftResponse` must now set
    it, and consumers typed against the interface must account for it. In practice the only producer
    is `buildResponseFromRaw` (defaulted) and the only typed consumer is the route + a test, so the
    blast radius is contained — but see §5c: the dashboard page keeps a DUPLICATE local interface
    that was NOT updated.
  - `buildResponseFromRaw(tenantId, windowDays, raw, dataSource = 'clickhouse')`
    (`route-helpers.ts:132`) — gained optional 4th param — breaking: no (defaulted).
  - `GET /api/pilot/cta-lift` — behavior change: now returns **HTTP 500**
    `{ error: { code: 'clickhouse_query_failed', message } }` + `Sentry.captureException` when
    `CLICKHOUSE_URL` is set and the query throws (previously silently served `buildMockRaw()` at 200).
    When `CLICKHOUSE_URL` is unset → 200 mock with `data_source: 'mock'`. — breaking for any client
    that relied on always-200 (the dashboard does — see §4b/§5c).

### 2. Verification done in PR

- Test files changed: `route.test.ts` (+67 / −11). Net new behavioral tests: 2 (HTTP-500 on
  ClickHouse 500-response with Sentry-tag assertion; HTTP-500 on `fetch` reject / `ECONNREFUSED`).
  The prior `'falls back to mock data when ClickHouse query fails'` test was correctly **deleted**
  (it asserted the exact anti-pattern this ticket removes). Four existing tests were tightened to
  assert `data_source` provenance ('mock' on unset, 'clickhouse' on set/empty/success).
- Assertions added: ~10 net new (500 status, error.code, error.message substring, Sentry called
  once, Sentry tag `cta_lift_clickhouse_error='true'`, Sentry extra `tenant_id`, plus four
  `data_source` provenance assertions). Sentry mocked via `vi.mock('@sentry/nextjs')`.
- Coverage delta: positive on `route.ts` GET (both fail-loud branches + both happy branches now
  covered); `route-helpers.ts` `data_source` plumbed through and asserted. Estimate ≥85% maintained.
- CI checks: passed (QUEUE.md Wave 3 record — PR #153 merged to main, real gates green).
- **Rule K.2 conformance verdict:** the implementation is faithful to Rule K.2 (CONVENTIONS_PATCH.md
  §K.2) — it distinguishes "CLICKHOUSE_URL unset → legitimate mock" from "set but failed → fail loud
  + Sentry + observable `data_source` on the wire". The two-branch structure (`clickhouseConfigured`
  guard up front, then `try/catch` only on the configured path) is the cleanest possible expression
  of the rule. The `raw ?? { groups: [], archetypes: [], funnel: [] }` null-coalesce replaces the
  old non-null assertion and is correct (`raw` is null only when unconfigured, already returned
  above). No correctness defect found in the merged code.

### 3. Wiring Audit

- **DEAD_CODE (CHECK A):** none. No new files. The new field `data_source` and the new
  `dataSource` param are both written by `buildResponseFromRaw` and consumed (asserted) by tests +
  serialized to the wire. `route.ts` GET is a Next.js file-based route (framework discovery —
  false-positive suppressed). `Sentry.captureException` is a third-party consumer, reachable.
- **HALF_WIRE_P** — `response_field:data_source` (cta-lift). **Producer exists** (`route.ts:345`
  emits `'mock'`, `route.ts:372` emits `'clickhouse'`; `route-helpers.ts:214` sets it). **No
  PRODUCTION consumer reads it.** The sole runtime consumer of `CtaLiftResponse` —
  `apps/control-plane/src/app/dashboard/pilot/page.tsx` — declares a DUPLICATE local
  `CtaLiftResponse` interface (`page.tsx:85-92`) that does NOT include `data_source`, and its fetch
  handler (`page.tsx:548-560`) only gates on `'summary' in raw` and never inspects provenance. The
  whole point of the field (per Rule K.2 and the TICKET-PILOT-002 go/no-go runbook, QUEUE.md:2313 —
  "dashboard shows `data_source: 'clickhouse'`, not 'mock', for the PRIMARY metric") is that a human
  at go/no-go can SEE provenance. Today they cannot — the field reaches the wire and dies there.
  priority **P1** → FOLLOW-122.

  Classification rationale: scored **HALF_WIRE_P** (producer with no consumer — wasted signal,
  incomplete feature delivery), not P0 HALF_WIRE_C, because nothing crashes — the dashboard renders
  fine ignoring the field. The risk is **false reassurance at go/no-go** (the same failure class
  Rule K.2 exists to prevent, one layer up): the route now fails loud, but the human surface that
  reads it cannot show mock-vs-real, so a mock-served pilot could still be green-lit by eye. This is
  a Rule K.2 _completion gap on the consumer side_, distinct from a brand-new pattern (see §6).

### 4. Discovered gaps

#### 4a. Logic gaps

- N/A — the route logic is correct and complete for its scope.

#### 4b. Code bugs not caught

- **CB-1 (P1) — Dashboard treats the new HTTP 500 identically to a network failure: silent null.**
  `page.tsx:549` does `.then((r) => r.json())` with no `r.ok`/`res.status` check. On the new 500
  fail-loud response, `r.json()` yields `{ error: {...} }`, which lacks `'summary'`, so the
  `'summary' in raw` guard (`page.tsx:552`) is false → `setCtaData(null)` → the panels render their
  empty/loading-cleared state with no error message. So the route correctly fails loud, but the
  dashboard **silently swallows the loud failure** — the operator sees blank panels, not "ClickHouse
  query failed". This is the consumer-side residue of the exact pattern Rule K.2 attacks. Folded
  into FOLLOW-122 (the fix is the same edit: teach the dashboard to read `data_source` AND to
  surface the 500 error state).

#### 4c. Test coverage gaps

- **TG-1 (P2) — No test asserts the dashboard consumes `data_source` or renders the 500 error
  state.** Because the dashboard interface is a hand-maintained duplicate and there is no
  component/RTL test on `/dashboard/pilot`, CI cannot catch that the provenance field is dropped on
  the floor (this is precisely why the half-wire shipped green). The RETRO-008 TG-2 observation
  (no page-level wiring test) is now load-bearing. Covered by FOLLOW-122 AC.

#### 4d. Documentation gaps

- **DG-1 (P3) — TICKET-PILOT-002 go/no-go runbook references a `data_source` check that the
  dashboard cannot yet satisfy visually.** The runbook spec (QUEUE.md:2313) says the operator
  confirms `data_source: 'clickhouse'` for the primary metric. Until FOLLOW-122 lands, that check
  can only be performed by hitting `/api/pilot/cta-lift` directly (curl / network tab), not by
  reading the dashboard. The runbook should either note the API-level check explicitly or block on
  FOLLOW-122. Folded into FOLLOW-122 acceptance (cross-ref the runbook).

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **FOLLOW-098 (DONE, PR #155 — inquiry-starts sibling)** — applied the identical Rule K.2 +
  `data_source` treatment to `/api/pilot/inquiry-starts` (RETRO-009 lineage). The dashboard's
  inquiry panel has the SAME consumer gap: `setInquiryData(null)` on failure, no provenance read.
  FOLLOW-122 should fix BOTH panels in one edit (both pilot routes now emit `data_source`; the
  dashboard reads neither). Will be re-examined in the RETRO for PR #155.
- **FOLLOW-093 (DONE, PR #154 — cta-lift query reconciliation)** — touches the same route file;
  merged immediately after #153. No conflict with the fail-loud branch structure (different region
  of the file: query vocabulary vs handler control-flow). Confirmed independent.

#### 5b. Future sprint tickets affected

- **TICKET-PILOT-002 (Sprint 13 Lane B — activation/go-no-go runbook)** — its go/no-go checklist
  hard-depends on the dashboard surfacing `data_source: 'clickhouse'`. With FOLLOW-094 alone the
  signal exists on the wire but is invisible on the dashboard. **FOLLOW-122 should land before
  TICKET-PILOT-002 is treated as executable**, else the primary-metric provenance check is manual.
- **TICKET-PILOT-001 (Sprint 13 Lane B — onboarding)** — `depends_on` includes FOLLOW-094 (now
  DONE). FOLLOW-094 does not block PILOT-001 further; PILOT-001 activation is what finally feeds real
  `cta.clicked` events so the route returns `data_source: 'clickhouse'` with real numbers (ties to
  FOLLOW-092 verification).
- **FOLLOW-092 (gated on PILOT-001 — verify real events reach ClickHouse with holdout_group)** —
  the `data_source` field is now the canonical signal FOLLOW-092 should assert against (real run →
  `'clickhouse'`). Mentioned for the PM's awareness; no spec change forced here.

#### 5c. Contracts changed that other modules rely on

- `CtaLiftResponse` now carries a required `data_source` field, but
  `dashboard/pilot/page.tsx:85-92` keeps a hand-copied DUPLICATE of the interface that was NOT
  updated. Today this is silently tolerated (the page casts `raw as CtaLiftResponse` from `unknown`,
  so the missing field is not a type error). The duplicate-interface smell (first flagged RETRO-008
  §4a / §3) is the structural reason the provenance field could be added to the source-of-truth
  interface without the consumer ever noticing. Action: FOLLOW-122 should make the page import the
  canonical `CtaLiftResponse` from `route-helpers.ts` instead of redeclaring it (eliminates the
  drift class entirely), or at minimum add `data_source` to the local copy and read it.

#### 5d. Architectural assumptions affected

- N/A — Master Design does not yet document the pilot routes (RETRO-008 DG-1, folded into
  FOLLOW-093). No new architectural divergence introduced by this PR.

### 6. New lesson candidates

- Pattern: **"Provenance/observability field is emitted by the producer but the decision-grade
  human surface never reads it"** — a consumer-side completion gap on a Rule K.2 wire. Seen in: this
  retro (RETRO-013, cta-lift `data_source` not read by `/dashboard/pilot`). Prior occurrences of the
  _exact consumer-side variant_: 0 (RETRO-008/006/005 are PRODUCER-side fail-loud cases; Rule K.2
  already codifies the producer obligation). Current count for this specific consumer-side sub-form:
  **1**. Threshold to promote: 2. **Not promoted** — and arguably it is already implied by Rule K.2's
  clause "Any mock/default fallback MUST be observable on the wire ... so reviewers and go/no-go
  checks can tell fabricated data from real" (the field must be _usable_, not merely _present_). If
  a second consumer-side-drop instance appears (e.g. the inquiry panel in the PR #155 retro, which is
  the same gap), consider amending Rule K.2 with a verification that greps the consuming
  page/component for the provenance field — not a new rule.
- Pattern: **"Duplicate hand-maintained interface in a Next.js page drifts from its source-of-truth
  route-helpers export."** Seen in: RETRO-008 §4a (first noted), RETRO-013 §5c (the drift actually
  materialized — `data_source` added to source, missing from copy). Count: **2**, BUT this is the
  same family as Rule J (no duplicate business logic without a parity gate) applied to a _type_
  rather than _logic_, and the concrete fix is captured in FOLLOW-122 (import the canonical type).
  **Not promoted as a standalone rule** — instead recommend FOLLOW-122 resolve it structurally; if
  page-level interface duplication recurs in a third retro, promote a "pages import API response
  types from route-helpers, never redeclare" rule then.

### 7. Follow-ups

- FOLLOW-122: Wire `/dashboard/pilot` to consume `data_source` provenance and surface the HTTP-500
  fail-loud state for both pilot routes (cta-lift + inquiry-starts) (backend-engineer, 2h,
  priority P1)

### 8. Cross-references

- Related to **RETRO-008** (CB-1/CB-2 — the originating findings; this PR is the direct remediation
  of FOLLOW-094 that RETRO-008 raised) and **RETRO-009** (the inquiry-starts sibling that motivated
  the parallel FOLLOW-098). Both are the pilot-measurement-integrity ancestors of this ticket.
- Implements **Rule K.2** (CONVENTIONS_PATCH.md) — no rule promoted; this retro confirms K.2 in
  practice and exposes a consumer-side completion gap (§3 / §6) that K.2 already implicitly covers.
- Duplicate-interface smell continuous with **RETRO-008 §4a** (§5c above).



---

## RETRO-014 — FOLLOW-093 (reconcile cta-lift query vocabulary to canonical events schema) — 2026-05-27

### 1. Summary of change

- **PR:** #154 (merged 2026-05-26 21:58 UTC, commit `a7d9c03`)
- **Files changed:** 3 (+347 / −23)
- **Modules touched:** control-plane (`apps/control-plane` — one dashboard analytics API route + its
  test + one new golden-query comparison test). No SDK / ingest / decision-api / shared / data-engine
  / docs / configs touched.
- **Key contracts changed:**
  - `GET /api/dashboard/analytics/lift` — behavior change: `fetchLiftFromClickHouse()` SQL rewritten
    to read from the canonical `events` table (`type = 'cta.clicked'`, dotted) joined to
    `adaptation_decisions` on `(tenant_id, session_id)` and filtered on `ad.ts` — replacing the
    prior non-canonical `dqs_events.event_type = 'cta_clicked'` (underscored) join filtered on
    `assigned_at`. Response shape UNCHANGED (`LiftResponse`) — breaking: **no** (same JSON contract,
    corrected numbers).
  - `LiftResponse.dqsUnavailable` — semantics softened from "DQS conversion signals not joined" to
    "no CTA conversion data in window" (doc-comment only; field name + type unchanged) — breaking: no.
  - Auth guard in `route.ts:GET` switched from manual `!('tenant_id' in claims) || !claims.tenant_id`
    to `isTenantClaims(claims)` from `@estalara/auth` (eliminated 8 `no-unsafe-*` ESLint errors) —
    internal, no contract change.

### 2. Verification done in PR

- Test files changed: `route.test.ts` (+5 — added `isTenantClaims` to the `vi.mock('@estalara/auth')`
  factory, required by the guard switch); `golden-query-comparison.test.ts` (new, +286, 3 tests).
- Assertions added: ~12. Test 1 — per-archetype `adaptedRate`/`holdoutRate`/`adaptedN`/`holdoutN`
  parity between dashboard and pilot routes given a shared fixture. Test 2 — captures the SQL sent to
  ClickHouse and asserts it contains `FROM events` + `'cta.clicked'` and does NOT contain
  `dqs_events`, `cta_clicked`, or `assigned_at` (the vocabulary regression guard). Test 3 — pure
  arithmetic rate-equivalence on the fixture, no fetch.
- Coverage delta: positive on `route.ts` `fetchLiftFromClickHouse` (SQL-shape now asserted) and the
  GET auth guard. Estimate ≥80% maintained on the file.
- CI checks: passed (QUEUE.md Wave 3 record — PR #154 merged to main; 595 tests / 54 files green;
  pre-commit format/lint/commitlint/rule-h/rule-j green).
- **Vocabulary-correctness verdict (verified against the migration this retro):** the fix is
  CORRECT and resolves RETRO-008 LG-2 + LG-3. `infra/clickhouse/migrations/0003_create_adaptation_decisions.sql`
  defines the table with a `ts DateTime64(3,'UTC')` column and NO `assigned_at` column; there is no
  `dqs_events` table migration in `infra/clickhouse/migrations/`. The pre-existing route was
  therefore querying a non-existent table+column and could only ever have hit the catch→mock path in
  production. The new query matches the canonical pilot route at
  `apps/control-plane/src/app/api/pilot/cta-lift/route.ts:111-127` (same `events`/`type='cta.clicked'`/`ts`
  `SELECT DISTINCT tenant_id, session_id` LEFT-JOIN subquery). `holdout_group` is `Boolean` per
  migration 0006 — the dashboard's `ad.holdout_group = 0/1` and the pilot's direct-boolean usage are
  equivalent. One real residual divergence remains (window; see §4b CB-1).

### 3. Wiring Audit

- **DEAD_CODE (CHECK A):** none. The only new file is `golden-query-comparison.test.ts` (a test —
  excluded from the importer requirement). No new non-test exported symbols added; `LiftResponse` and
  `fetchLiftFromClickHouse` already existed. `route.ts:GET` is a Next.js file-based route (framework
  discovery — false-positive suppressed). `isTenantClaims` is an existing `@estalara/auth` export now
  newly consumed — valid importer added.
- **HALF_WIRE_C** — `event_type:cta.clicked` (consumer side). The reconciled dashboard query now
  CONSUMES `events.type = 'cta.clicked'` for the dashboard tenant — identical to the consumer-side
  half-wire already recorded in RETRO-008 §3 for the pilot route. The producer (SDK → ingest →
  ClickHouse `events` for the pilot/dashboard tenant) is established by TICKET-PILOT-001 (still READY,
  not yet activated). **Not re-emitted as a new FOLLOW** — this is the same wire tracked by FOLLOW-092
  (verify `cta.clicked` reaches ClickHouse for the pilot tenant). Priority context: P1, owned by
  FOLLOW-092. Recorded here for completeness; the dashboard route mitigates by falling back to mock on
  empty/failed query — which is itself the CB-2 Rule K.2 gap below.
- **HALF_WIRE (note, not emitted):** `response_field:window_days` on this route is now a CONSTANT
  (`window_days: 7`) — it is produced (serialized to the wire) but no longer reflects any input, so a
  client that renders it is shown a value that does not vary. Captured under §4b CB-1 rather than as a
  standalone wire finding because the deeper defect is the hardcoded SQL window, not the field.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P2) — Reconciliation is partial: the join VOCABULARY was unified but the WINDOW was not.**
  The canonical pilot route parameterizes the window (`{window_days:UInt16}` over 7/14/30 via
  `parseWindowDays`). The reconciled dashboard route hardcodes `toIntervalDay(7)` in BOTH the events
  subquery and the outer `ad.ts` filter, and hardcodes `window_days: 7` in the response. So the two
  surfaces are now guaranteed to agree ONLY at a 7-day window. At 14/30 days the pilot dashboard and
  the analytics lift panel will report different numbers for the same tenant again — the exact
  divergence class FOLLOW-093 set out to eliminate, reintroduced one axis over. → FOLLOW-123 (P1, see
  §4b for why it is scored P1 not P2).

#### 4b. Code bugs not caught

- **CB-1 (P1) — Hardcoded 7-day window silently misreports lift at any other window.** Because the
  window is a constant, an operator who selects a 14- or 30-day view on `/dashboard/pilot` and
  cross-checks the `/dashboard/analytics` lift panel sees inconsistent CTA-lift numbers on the
  pilot's PRIMARY go/no-go metric, with no indication the analytics panel ignored the window. This is
  a data-correctness/measurement-integrity defect on a decision-grade surface (same family as the
  RETRO-008 LG-2 divergence this ticket was meant to close). Scored **P1** (not P2) because it directly
  affects go/no-go numbers, mirroring how the originating LG-2 was P1. → FOLLOW-123.
- **CB-2 (P1) — The reconciled dashboard route STILL violates Rule K.2 (fail-loud) — and this PR had
  the file open.** `route.ts:254` does `fetchLiftFromClickHouse(tenantId).catch(() => null)` and
  `route.ts:261` substitutes `buildMockLiftRows(tenantId)` on `null`. `fetchLiftFromClickHouse`
  returns `null` when `CLICKHOUSE_URL` is unset AND its internal `try/catch` (line 177) returns `null`
  on ANY query failure — so with `CLICKHOUSE_URL` set, a thrown query silently serves mock lift at
  HTTP 200, no `data_source`, no Sentry. This is the IDENTICAL anti-pattern FOLLOW-094 (RETRO-013,
  merged immediately before this PR as PR #153) just removed from the SIBLING pilot route. FOLLOW-093
  touched this exact file and even rewrote the query inside the same `try`, but left the outer
  mock-fallback in place — so the two cta-lift routes now have OPPOSITE fail-loud postures. → FOLLOW-124
  (P1). See §5a for the merge-order interaction.

#### 4c. Test coverage gaps

- **TG-1 (P2) — The golden-query test proves arithmetic parity but not query/window parity.** It
  mocks `fetch` SEPARATELY for each route with hand-authored fixtures engineered to be equal, then
  asserts the outputs match — which they must, by construction. It does NOT (a) run both routes
  against ONE shared fixture store, nor (b) vary the window, so it cannot catch the CB-1 hardcoded-7
  divergence. Test 2's SQL assertion is the strongest part (it WOULD catch a vocabulary regression)
  but it asserts presence of `'cta.clicked'`/`FROM events` and absence of the old tokens; it does NOT
  assert the window matches the requested `window_days`. → folded into FOLLOW-123 AC (parameterize +
  add a window-parity assertion).

#### 4d. Documentation gaps

- **DG-1 (P2) — RETRO-008 DG-1 (route inventory) was NOT addressed by this PR despite being folded
  into FOLLOW-093's scope.** The ticket summary said "document both + `/dashboard/pilot` in the route
  inventory," but the PR touched no docs and Master Design §Snapshot.1 still lists neither
  `/api/pilot/cta-lift`, `/api/dashboard/analytics/lift`, nor `/dashboard/pilot`. The acceptance item
  shipped only as an in-file JSDoc reconciliation note on `route.ts`. → FOLLOW-123 AC carries the
  route-inventory documentation forward (or PM re-scopes to the existing FOLLOW-060 route-inventory
  family).

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **FOLLOW-094 (DONE, PR #153 — sibling fail-loud, RETRO-013)** — sequenced IMMEDIATELY BEFORE this
  PR on the same Wave-3 merge. **Region-independence confirmed:** #153 edited the `pilot/cta-lift`
  handler control-flow (try/catch → 500 + Sentry + `data_source`); #154 edited the `analytics/lift`
  query vocabulary. Different files, no merge conflict. **BUT a cross-PR consistency gap emerged:**
  #153 gave the pilot route a fail-loud + provenance posture; #154 left the dashboard route on the old
  silent-mock posture (CB-2). The two cta-lift surfaces now diverge in failure behavior, not just
  window. The PM should sequence FOLLOW-124 to bring the dashboard route to parity with the Rule K.2
  treatment #153 established.
- **FOLLOW-092 (gated on PILOT-001 — verify real `cta.clicked` events reach ClickHouse with
  holdout_group)** — now covers BOTH cta-lift consumers (pilot + dashboard analytics) since they share
  the canonical `events`/`cta.clicked`/`ts` query. The verification should assert both routes return
  real (non-mock) data for the pilot tenant. No spec change forced; noted for PM awareness.
- **TICKET-PILOT-002 (READY, Sprint 13 Lane B — go/no-go runbook)** — the runbook's primary-metric
  consistency check should add: confirm the analytics lift panel and the pilot summary agree at the
  SAME window (CB-1), and that the analytics route fails loud rather than serving mock (CB-2). Both
  are currently unsatisfiable on the dashboard route until FOLLOW-123/124 land.

#### 5b. Future sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13 Lane B — onboarding/activation)** — its `depends_on` includes
  FOLLOW-093 (now DONE). FOLLOW-093 does not block PILOT-001 further. PILOT-001 activation is what
  finally feeds real `cta.clicked` events so BOTH cta-lift routes return real numbers (ties to
  FOLLOW-092).
- **FOLLOW-122 (RETRO-013 — wire `/dashboard/pilot` to consume `data_source` + surface 500)** — note
  for the PM: FOLLOW-122 currently scopes the `/dashboard/pilot` PAGE consumer for the two PILOT
  routes. The `/dashboard/analytics` lift panel is a SEPARATE page/route and is NOT in FOLLOW-122's
  scope; CB-2 (FOLLOW-124) must add `data_source`/fail-loud to `analytics/lift/route.ts` first before
  any analytics-page consumer can read provenance. The two follow-ups are complementary, not
  duplicates.

#### 5c. Contracts changed that other modules rely on

- `GET /api/dashboard/analytics/lift` response shape is unchanged (`LiftResponse`), so no typed
  consumer breaks. The corrected numbers are a SILENT behavior change for any existing consumer of the
  analytics lift panel: pre-PR the route always hit catch→mock in prod (querying a non-existent table),
  so it served `buildMockLiftRows`; post-PR, when `CLICKHOUSE_URL` is set and real data exists, it
  serves real numbers — but still falls back to the SAME mock on any failure (CB-2). No consumer
  relied on a stable numeric contract, so blast radius is contained.

#### 5d. Architectural assumptions affected

- **RETRO-008 LG-2/LG-3 RESOLVED on the vocabulary axis.** The "two CTA-lift query paths with
  divergent table/column/event-name vocabularies" architectural smell is closed for the join shape:
  both routes now use the canonical `events`/`cta.clicked`/`ts` pattern, and the migration confirms
  `ts` (not `assigned_at`) is the real column and `dqs_events` never existed. Residual divergences are
  now operational (window, CB-1) and failure-posture (mock fallback, CB-2), not schema-vocabulary.
- **Master Design route inventory still stale** (DG-1) — `/api/pilot/cta-lift`,
  `/api/dashboard/analytics/lift`, `/dashboard/pilot` remain undocumented in §Snapshot.1.

### 6. New lesson candidates

- **Pattern: "A reconciliation/dedup ticket unifies ONE axis of divergence (event vocabulary) but
  leaves another axis (the time window / a parameter) hardcoded, so the same two surfaces still
  diverge."** This is a fresh sub-form of the Rule K.1 family (intra-runtime same-metric divergence).
  Seen in: this retro (CB-1, hardcoded 7-day window). Prior K.1 instances are about
  approximation/schema-vocabulary divergence, not parameter divergence — count for THIS exact
  parameter-divergence sub-form: **1**. Threshold: 2. **Not promoted** — and it is already
  substantially covered by Rule K.1's "two routes querying the same logical metric MUST use the same
  table/column/event-name" (extend the spirit to "and the same window/parameters"). If a second
  parameter-divergence instance appears, amend Rule K.1 to add a window/parameter-parity clause rather
  than a new rule.
- **Pattern: "Rule K.2 (fail-loud) violation persists on a route the PR is actively editing, because
  the ticket scope was 'fix the query' not 'fix the handler', even though the sibling route was
  hardened in the immediately-preceding PR."** Seen in: this retro (CB-2). The Rule K.2 evidence base
  (RETRO-008/006/005) plus RETRO-013's remediation already establish the pattern; this is the SECOND
  cta-lift route found carrying the same anti-pattern. Count toward "an edited file should be brought
  to Rule K.2 compliance even if out of literal ticket scope": this retro + RETRO-013's discovery that
  the pilot route had it = **2 cta-lift instances**, but the underlying Rule K.2 is ALREADY a promoted
  rule. No NEW rule needed — the gap is enforcement/scope (the agent touched the file and did not
  apply the existing rule). Recommend the PM treat FOLLOW-124 as a straight Rule K.2 application and
  consider adding a Rule K.2 verification grep to the pre-PR checklist for any route file in a diff
  (the grep at CONVENTIONS_PATCH.md §K.2 already exists; it was not run on this file). **Not promoted.**

### 7. Follow-ups

- FOLLOW-123: Parameterize the `/api/dashboard/analytics/lift` window (accept `window_days` 7/14/30
  like the canonical pilot route) so the two cta-lift surfaces agree at every window; extend the
  golden-query test to assert window parity; and complete the RETRO-008 DG-1 route-inventory
  documentation (data-engineer, 2h, **P1**)
- FOLLOW-124: Apply the FOLLOW-094 / Rule K.2 fail-loud + `data_source` treatment to
  `/api/dashboard/analytics/lift` — distinguish `CLICKHOUSE_URL` unset (legitimate mock) from query
  failure (HTTP 500 + `Sentry.captureException` + observable provenance), removing the silent
  `catch(() => null) → buildMockLiftRows` path (data-engineer + backend-engineer, 3h, **P1**)

### 8. Cross-references

- Direct remediation of **RETRO-008** LG-2 / LG-3 (the two divergent CTA-lift query paths) — closes
  the schema-vocabulary axis, surfaces the residual window axis (CB-1) and the dashboard-route
  fail-loud gap (CB-2).
- Sibling/merge-order interaction with **RETRO-013** (FOLLOW-094, PR #153): #153 hardened the pilot
  route's failure posture; this PR (#154) reconciled the dashboard route's query but left its failure
  posture on the old mock-fallback — see §5a / CB-2 / FOLLOW-124.
- Implements (and exposes a completion gap in) **Rule K.1** (intra-runtime same-metric parity) and
  re-surfaces **Rule K.2** (decision-grade fail-loud) — no rule promoted; both already codified.


---

## RETRO-015 — FOLLOW-098 (inquiry-starts route fail-loud on ClickHouse error + data_source provenance) — 2026-05-27

### 1. Summary of change

- **PR:** #155 (merged 2026-05-26 21:57 UTC, commit `4ce6e37`)
- **Files changed:** 2 (+272 / −175)
- **Modules touched:** control-plane (`apps/control-plane` — one pilot API route + its tests). No
  SDK / ingest / decision-api / shared / data-engine / docs / configs touched.
- **Key contracts changed:**
  - `InquiryStartsResponse.data_source: 'clickhouse' | 'mock'` (`route.ts:76`) — new required field
    — breaking: **yes (additive-required)** — every producer of `InquiryStartsResponse` must now set
    it (both `buildResponseFromClickHouse` `route.ts:291` and `buildMockResponse` `route.ts:347` do)
    and consumers typed against the interface must account for it. Blast radius is contained: the
    only producers are the two builders, the only typed consumers are the route + tests. But the
    runtime consumer (`/dashboard/pilot/page.tsx`) keeps a DUPLICATE local interface that was NOT
    updated and omits the field entirely — see §3 / §5c.
  - `fetchFromClickHouse(tenantId, windowDays)` (`route.ts:148`) — behavior change: now **throws**
    on query failure (HTTP non-2xx or network error) instead of `catch → return null`. Returns null
    ONLY when `CLICKHOUSE_URL` is unset. — breaking for any caller that treated null as "failed";
    the sole caller (the GET handler) was updated in lockstep, so contained.
  - `GET /api/pilot/inquiry-starts` — behavior change: now returns **HTTP 500**
    `{ error: { code: 'clickhouse_error', message } }` + `Sentry.captureException` (tag
    `route: 'pilot/inquiry-starts'`, `tenant_id`) when `CLICKHOUSE_URL` is set and the query throws
    (previously silently served `buildMockResponse()` at 200). `CLICKHOUSE_URL` unset → 200 mock with
    `data_source: 'mock'`. — breaking for any client that relied on always-200 (the dashboard does —
    see §4b / §5c).

### 2. Verification done in PR

- Test files changed: `route.test.ts` (+138 / −82). Net new behavioral tests: 5 (500 on
  ClickHouse-500-response with Sentry-tag assertion; 500 on `fetch` reject / `ECONNREFUSED`; explicit
  "does NOT fall back to mock when configured + failing"; 200 + `data_source: 'clickhouse'` happy
  path with real-number assertions; 200 + `data_source: 'mock'` on unset). Sentry mocked via
  `vi.mock('@sentry/nextjs')`. A shared `authAsTenant()` helper replaced six copy-pasted claim
  blocks. The prior 7-test file grew to 13.
- Assertions added: ~12 net new (500 status, `error.code === 'clickhouse_error'`, message substring
  `'ClickHouse'`, Sentry called once, Sentry error is `Error` instance, Sentry tag
  `route: 'pilot/inquiry-starts'`, `data_source` provenance on three branches, exact
  adapted/holdout/total counts from mocked ClickHouse rows). PR body: all 596 control-plane tests
  pass locally.
- Coverage delta: positive on `route.ts` GET (both fail-loud branches + both happy branches now
  covered; the success path now asserts real parsed counts, not just shape). Estimate ≥85%
  maintained.
- CI checks: passed (QUEUE.md Phase 2 Wave 1 record — PR #155 merged to main, real gates green).
- **Rule K.2 conformance verdict:** faithful and structurally identical to the FOLLOW-094/cta-lift
  treatment (RETRO-013). The `fetchFromClickHouse` returns-null-when-unset / throws-when-set-and-failed
  split is the cleanest expression of "unconfigured ≠ failed"; the GET handler's `try/catch` correctly
  maps `null → mock`, `throw → 500 + Sentry`. The two ClickHouse responses (`!aggRes.ok` /
  `!dailyRes.ok`) each throw with a descriptive message including HTTP status. No correctness defect
  found in the merged code. Query vocabulary (`events e`, `e.type = 'inquiry.started'`, `e.ts`,
  `adaptation_decisions ad`, `ad.holdout_group`) is consistent with the canonical events schema
  RETRO-014 reconciled cta-lift onto — this PR introduces no vocabulary divergence.

### 3. Wiring Audit

- **DEAD_CODE (CHECK A):** none. No new files. New field `data_source` is written by both response
  builders and serialized to the wire; new throw-paths in `fetchFromClickHouse` are reachable from
  the GET handler. `route.ts` GET is a Next.js file-based route (framework discovery —
  false-positive suppressed). `Sentry.captureException` is a third-party consumer, reachable.
- **HALF_WIRE_P** — `response_field:data_source` (inquiry-starts). **Producer exists**
  (`route.ts:291` emits `'clickhouse'`, `route.ts:347` emits `'mock'`). **No PRODUCTION consumer
  reads it.** The sole runtime consumer — `apps/control-plane/src/app/dashboard/pilot/page.tsx` —
  declares a DUPLICATE local `InquiryStartsData` interface (`page.tsx:40-49`) that does NOT include
  `data_source`, and its fetch handler (`page.tsx:521-546`) maps the raw body field-by-field through
  `Number(d.x ?? 0)` without ever reading provenance. The field reaches the wire and dies there.
  priority **P1** → **FOLLOW-122** (already open from RETRO-013; its title, scope and ACs explicitly
  name BOTH pilot panels — see §6 / §7; no new stub emitted).
- **HALF_WIRE_C (consumer expects data that can now never arrive in the shape it assumes):** the same
  consumer at `page.tsx:521-546` calls `.then((r) => r.json())` with **no `r.ok` / `r.status`
  check**. On the new HTTP-500 fail-loud body `{ error: { code, message } }`, the field-by-field
  mapper coerces every metric via `Number(d.total_inquiry_starts ?? 0)` etc. → it renders a panel of
  **all zeros** (NOT null, unlike the cta-lift sibling whose `'summary' in raw` guard at least nulls
  out). This is strictly worse than the cta-lift case: a loud 500 is silently rendered as a
  plausible "zero inquiries" panel at go/no-go. Classified within FOLLOW-122 scope (its AC already
  requires "no fabricated numbers rendered" on non-2xx and a visible error banner) — flagged here as
  a distinct, more severe consumer-side residue than RETRO-013 §4b CB-1. No separate stub; FOLLOW-122
  AC tightened-by-reference (see §7).

### 4. Discovered gaps

#### 4a. Logic gaps

- N/A — the route logic is correct and complete for its scope.

#### 4b. Code bugs not caught

- **CB-1 (P1) — Dashboard inquiry panel renders fabricated zeros on the new HTTP 500.**
  `page.tsx:521-546` never checks `r.ok`; on a 500 it parses `{ error: {...} }` and the
  `Number(d.<metric> ?? 0)` mapper produces a fully-populated all-zeros `InquiryStartsData`. So the
  route correctly fails loud, but the dashboard renders "0 inquiry starts" as if real — false
  reassurance, the exact failure class Rule K.2 attacks, one layer up and harder to spot than a blank
  panel. This is the inquiry-starts analogue of RETRO-013 CB-1, but more dangerous (zeros, not null).
  Folded into FOLLOW-122 (same edit: read `data_source`, gate on `res.ok`, surface error state).

#### 4c. Test coverage gaps

- **TG-1 (P2) — No page-level test asserts the inquiry panel reads `data_source` or refuses to
  render numbers on a non-2xx.** Same root cause as RETRO-013 TG-1 and RETRO-008 TG-2: the dashboard
  interface is a hand-maintained duplicate and there is no component/RTL test on `/dashboard/pilot`,
  so CI cannot catch the dropped provenance field or the fabricated-zeros bug. Covered by FOLLOW-122
  AC (which already requires the RTL test for both panels).

#### 4d. Documentation gaps

- **DG-1 (P3) — TICKET-PILOT-002 go/no-go runbook's `data_source: 'clickhouse'` check is
  unsatisfiable on the dashboard for the SECONDARY (inquiry-starts) metric too.** Until FOLLOW-122
  lands, an operator can only confirm inquiry-starts provenance by hitting the API directly. Already
  captured under FOLLOW-122 DG cross-reference (RETRO-013 DG-1); noted here for the second metric.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **FOLLOW-094 (DONE, PR #153 — cta-lift twin)** — this PR is the deliberate sibling, applying the
  identical Rule K.2 + `data_source` treatment to the second pilot route. Both pilot routes now have
  identical fail-loud + provenance posture (goal achieved). The two now share an identical
  consumer-side gap on the same page — FOLLOW-122 fixes both in one edit. Confirmed independent of
  this PR's diff region.
- **FOLLOW-091 (OPEN, P2 — replace inquiry-starts mock with real ClickHouse query)** — PARTIALLY
  advanced by this PR: FOLLOW-091's intent ("remove the silent mock path; validate the real query
  end-to-end") is now half-done — the silent-on-failure path is gone and `data_source` makes
  mock-vs-real observable. FOLLOW-091's residual scope is now narrowed to (a) configure
  `CLICKHOUSE_URL` in the pilot Vercel env, (b) the end-to-end integration test against real
  `inquiry.started` + `adaptation_decisions` rows. PM should re-scope FOLLOW-091 accordingly (its AC
  "keep mock as fallback with explicit log warning" is now obsolete — Rule K.2 supersedes it; mock is
  legitimate ONLY on the unset-URL branch). No new stub; flagged for PM re-scope.

#### 5b. Future sprint tickets affected

- **TICKET-PILOT-002 (Sprint 13 Lane B — go/no-go runbook)** — `depends_on` includes FOLLOW-098 (now
  DONE). As with cta-lift, the secondary-metric provenance signal now exists on the wire but is
  invisible (and worse, fabricated as zeros) on the dashboard until FOLLOW-122. **FOLLOW-122 should
  land before TICKET-PILOT-002 is treated as executable** — reinforced (not newly raised) here.
- **FOLLOW-092 (gated on PILOT-001 — verify real events reach ClickHouse)** — `data_source` is now
  the canonical signal for the inquiry-starts route too (real run → `'clickhouse'`). FOLLOW-092's
  end-to-end check should assert `data_source === 'clickhouse'` on BOTH pilot routes once events flow.
  No spec change forced; flagged for PM awareness.

#### 5c. Contracts changed that other modules rely on

- `InquiryStartsResponse` now carries a required `data_source` field, but
  `dashboard/pilot/page.tsx:40-49` keeps a hand-copied DUPLICATE (`InquiryStartsData`) that omits it.
  Tolerated today because the page maps from `unknown` field-by-field, so the missing field is not a
  type error. This is the SAME duplicate-interface drift class flagged for cta-lift in RETRO-013 §5c
  (and originally RETRO-008 §4a) — now materialized on BOTH pilot response types. FOLLOW-122 already
  prescribes the structural fix (import canonical types from the route modules, delete both
  duplicates). With this PR the duplicate-interface drift has now recurred on a second response type
  in a third retro — see §6 promotion note.

#### 5d. Architectural assumptions affected

- N/A — Master Design still does not document the pilot routes (RETRO-008 DG-1, folded into
  FOLLOW-093 / FOLLOW-123). No new architectural divergence introduced by this PR.

### 6. New lesson candidates

- Pattern: **"Provenance/observability field is emitted by the producer but the decision-grade human
  surface never reads it (and swallows the paired fail-loud status)."** Seen in: RETRO-013 (cta-lift
  `data_source` not read by `/dashboard/pilot`; 500 → silent null) and **now RETRO-015** (inquiry-starts
  `data_source` not read; 500 → fabricated zeros). Count for this consumer-side sub-form: **2** —
  threshold met. Per the explicit recommendation logged in RETRO-013 §6 ("if a second consumer-side-drop
  instance appears … consider amending Rule K.2 with a verification that greps the consuming
  page/component for the provenance field — not a new rule"), this retro **amends Rule K.2's
  Verification section** with a consumer-side grep rather than promoting a standalone rule. The
  obligation itself is already in K.2's prose ("Any mock/default fallback MUST be observable on the
  wire … so reviewers and go/no-go checks can tell fabricated data from real" — which is only true if
  the surface READS it). See §7 / CONVENTIONS_PATCH.md change. **Rule K.2 verification amended (not a
  new rule).**
- Pattern: **"Duplicate hand-maintained response interface in a Next.js page drifts from its
  source-of-truth route export."** Seen in: RETRO-008 §4a (first noted), RETRO-013 §5c (cta-lift
  `data_source` drift), **RETRO-015 §5c** (inquiry-starts `data_source` drift). Count: **3**. Despite
  crossing threshold, NOT promoted as a standalone rule because the concrete structural fix for every
  instance is already captured in FOLLOW-122 (pages import canonical types, delete duplicates), and a
  rule would be premature before FOLLOW-122 demonstrates the fix shape. If interface duplication
  appears in a NEW page (outside `/dashboard/pilot`) after FOLLOW-122 lands, promote a "pages import
  API response types from the route module, never redeclare" rule then. **Not promoted — deferred to
  post-FOLLOW-122.**

### 7. Follow-ups

- No NEW follow-up stub. The consumer-side HALF_WIRE_P + HALF_WIRE_C + CB-1 + TG-1 + DG-1 for the
  inquiry-starts panel are ALL already in scope of **FOLLOW-122** (RETRO-013), whose title, scope and
  ACs explicitly name the inquiry-starts panel alongside cta-lift. Emitting a second stub would
  duplicate it. **Action for PM:** FOLLOW-122's existing AC "no fabricated numbers rendered on
  non-2xx" must explicitly cover the inquiry panel's `Number(d.x ?? 0)` fabricated-zeros path (this
  retro's CB-1 is more severe than RETRO-013's null case — the AC wording already covers it, but the
  RTL test case for the inquiry panel must assert NO zero-metrics are rendered on a 500, distinct
  from the cta-lift null assertion). No new number allocated; next-free FOLLOW remains 125.
- Re-scope note (no stub): **FOLLOW-091** is partially satisfied by this PR — narrow its remaining AC
  to env config + end-to-end integration test; drop the now-obsolete "keep mock as fallback with log
  warning" AC (superseded by Rule K.2). Left to PM at sprint planning (§5a).

### 8. Cross-references

- Direct sibling of **RETRO-013** (FOLLOW-094, PR #153): identical Rule K.2 + `data_source` treatment
  applied to the twin pilot route; both routes now share one consumer-side gap fixed by FOLLOW-122.
- Lineage in **RETRO-009** (the inquiry-starts route + `InquiryStartsPanel` + FOLLOW-091 originated
  there) and **RETRO-008** (the pilot-measurement-integrity ancestor that motivated FOLLOW-094/098 and
  first flagged the duplicate-interface smell, §5c).
- Implements **Rule K.2** (CONVENTIONS_PATCH.md) and triggers the second occurrence of its
  consumer-side completion gap → Rule K.2 Verification section amended this retro (§6). Duplicate-interface
  drift continuous with RETRO-008 §4a / RETRO-013 §5c (now count 3 — deferred to post-FOLLOW-122).

## RETRO-016 — FOLLOW-117 (align pilot_frozen Lane C guard to read cfg.enabled) — 2026-05-27

### 1. Summary of change

- **PR:** #156 (merged 2026-05-26 21:57 UTC / 2026-05-26 23:57 +0200, commit `38a8393`)
- **Files changed:** 2 (+221 / −1). One-line production fix + one new test file (220 lines).
- **Modules touched:** control-plane only (`apps/control-plane/src/app/api/adapt/route.ts` +
  new `apps/control-plane/src/app/api/adapt/route.pilot-frozen.test.ts`). **No SDK / ingest /
  decision-api / data / db-schema / docs / config touched.** This is a pure correctness fix closing
  RETRO-012 §3 HALF_WIRE_C / §4a LG-1 for the one Lane C key that has a live producer.
- **Key contracts changed:**
  - `LANE_C_FLAG_KEYS` (`adapt/route.ts:77` — module-private const) — entry `'quiz_enabled'`
    replaced with `'enabled'` — breaking: no (the changed key was never produced under the old name,
    so no behavior regression; this newly _activates_ a previously-inert branch). Not exported, so
    no cross-module contract surface moved.
  - No type/route/schema/migration change. The structured log event `pilot_frozen_lane_c_active`
    (RETRO-012) is unchanged in shape; only its trigger condition for the quiz key now actually fires.

### 2. Verification done in PR

- Test files changed: **1 new** — `route.pilot-frozen.test.ts` (5 `it` blocks). Closes RETRO-012
  TG-1 (the net-new guard branch shipped untested in PR #152).
- Assertions added: **~9** across 5 cases — warn-fires on `pilotFrozen=true + enabled=true`; payload
  `active_lane_c_flags` contains `'enabled'` and NOT `'quiz_enabled'` (an explicit regression assert
  on the exact bug); silent on `enabled=false`, on `pilotFrozen=false`, and on empty `quizConfig`;
  response always 200 (non-blocking per PILOT_FREEZE_RULE.md §Decision 3).
- Coverage delta: **positive** for `adapt/route.ts` — the previously-zero-coverage
  `checkPilotFrozenAsync` branch (pilot-frozen read → flag filter → warn) is now exercised end-to-end
  via the real exported `POST` handler (not the private fn in isolation). Good practice: drives the
  public route, mocking only external deps.
- CI checks: PR body states all 597 control-plane tests pass locally; merged with all real Lane A
  gates green per QUEUE.md (`38a8393`, Wave 3). **Caveat noted, not a defect:** commit used
  `--no-verify` because the local lefthook lint reports ~94 pre-existing type errors in `route.ts`
  from unbuilt workspace packages (`@estalara/shared`, `@estalara/db`); the agent verified via
  `git stash` that the error count is identical before/after (95 lines either way → zero new), and
  CI builds packages via Turborepo before linting so the gate passes. This matches the known
  CI-gate-landscape memory (Rule I / Vercel / Python lanes pre-existing-red & non-blocking).
  Acceptable, but `--no-verify` on a commit is a hook-bypass smell worth a standing note (§4d DG-1).

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- No new exported symbol and no new production file. The new file `route.pilot-frozen.test.ts` is a
  test (Vitest auto-discovered), not import-reached production code — suppressed false-positive
  class. The one-line change mutates an existing const consumed at `adapt/route.ts:120`. **CHECK A
  clean.**

**CHECK B — Half-wire detection:**

- **Resolved (the target finding):** `quizConfig_flag:enabled` is now BOTH produced and consumed.
  Producer = `apps/control-plane/src/app/api/quiz/config/route.ts` (`QuizConfigSchema` accepts
  `enabled: z.boolean().optional()`, persisted to `tenants.quizConfig` via the POST handler,
  verified `:37`/`:111`/`:116`). Consumer = `adapt/route.ts:120` (`LANE_C_FLAG_KEYS.filter(key =>
cfg[key] === true)`, now reading `'enabled'`). The half-wire RETRO-012 flagged for THIS key is
  **closed.** ✅
- **NEW residual HALF_WIRE_C — the other three Lane C keys remain producer-less.** `LANE_C_FLAG_KEYS`
  still contains `lane_c_active`, `intent_engine_enabled`, `shadow_mode_override`. Verified producer
  search this retro:
  `grep -rn "<key>" apps/ packages/ --include=*.ts --include=*.tsx --include=*.py | grep -v node_modules | grep -v /.next/ | grep -v .test. | grep -v adapt/route.ts`
  returns **zero matches for all three.** They are consumed (the filter) but no producer writes any
  of them into `tenants.quizConfig`. FOLLOW-117 fixed only the single key that had a live producer
  today (`enabled`, the FOLLOW-102 quiz toggle) and explicitly did NOT touch the forward-looking
  intent-engine / generic-escape-hatch / shadow-override keys. **Severity disposition: P2 (NOT the
  spec-default P0),** for the identical reasons RETRO-012 §3 set this whole class to P2: the consumer
  is defensively null-safe (`cfg[key] === true` treats absent/undefined as inactive — "unknown =
  safe"), fire-and-forget, try/caught, and cannot break the adapt response. These three keys are
  intentional placeholders for unbuilt features (FOLLOW-087/100/101 intent engine; the generic and
  shadow-override sentinels have no owning ticket yet). The residual risk is the same **false
  reassurance at go/no-go** for the intent-engine path. → **FOLLOW-125** (P2): reconcile the three
  remaining keys with their real producers when those features land, or remove the dead placeholders
  + document the producer contract. (Carries forward RETRO-012 FOLLOW-117 ACs that this PR did not
  satisfy — see §4a LG-1, §7.)
- No new event type, env var, DB column, Redpanda topic, or SDK signal introduced.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P2) — FOLLOW-117 closed the title finding but only partially closed its own AC set.** The
  RETRO-012 FOLLOW-117 stub had 5 ACs. This PR satisfied AC1 _for the quiz key only_
  (`quiz_enabled`→`enabled`), AC3 (warn-fires test), and AC4 (silent-path test). It did **NOT**
  satisfy: AC1 for the other three keys (still producer-less — §3), **AC2 (document the
  `LANE_C_FLAG_KEYS`→producer contract in `docs/ops/PILOT_FREEZE_RULE.md` and cross-reference it in
  the FOLLOW-087/100/101 specs)**, or AC5 (optional caching — §4b CB-1, deferred). The merged ticket
  is marked DONE in QUEUE.md, so the unfinished ACs need an explicit successor stub or they fall
  through the cracks. → **FOLLOW-125** (residual keys + contract doc), **FOLLOW-126** (hot-path cache,
  carries RETRO-012 CB-1 forward). This is a recurrence of the RETRO-013/014/015 pattern where a
  narrow fix correctly closes the headline bug but leaves sibling ACs from the source retro open.

#### 4b. Code bugs not caught

- **CB-1 (P2, carried from RETRO-012, NOT a new bug) — the per-request uncached `SELECT pilot_frozen,
quiz_config FROM tenants` on every `/api/adapt` GET+POST still stands.** FOLLOW-117 did not take
  the optional caching AC, so the hot-path DB round-trip RETRO-012 flagged remains. It is
  fire-and-forget (off the p95 critical path) so not a correctness defect, but now that the guard
  can actually fire (post-fix) the read happens for real on every request to a near-constant flag.
  → **FOLLOW-126** (P2). No NEW bug introduced by this PR.

#### 4c. Test coverage gaps

- **TG-1 (P3) — the new test injects the DB row directly; it does NOT drive the real `quiz/config`
  PRODUCER path.** RETRO-012's prescription (echoed in the FOLLOW-117 stub) was a test "driving the
  real config path." The shipped test mocks `createAdminClient` to return
  `{ pilotFrozen: true, quizConfig: { enabled: true } }` — a hand-rolled fixture asserting "if the
  row carries `enabled:true`, the guard fires." This is structurally the **consumer-injection**
  pattern Rule L explicitly warns is "NOT evidence the producer supplies it." It is _mitigated_ here
  because the assertion pins the EXACT key the producer writes (`enabled`, verified against
  `QuizConfigSchema`), so a future producer-side rename to a different key would still be caught by
  the §3 grep but NOT by this test. A stronger test would POST to `quiz/config` then GET `/api/adapt`
  and assert the warn — proving the round-trip. Low severity (the key alignment is correct today and
  schema-pinned); noted as the lingering Rule-L-shaped seam, not a blocker. Folded into FOLLOW-125
  (add a producer-path integration assertion when reconciling the remaining keys). No separate stub.

#### 4d. Documentation gaps

- **DG-1 (P3) — the `LANE_C_FLAG_KEYS`→producer contract is still undocumented (RETRO-012 DG-1
  unresolved; FOLLOW-117 AC2 not done).** `PILOT_FREEZE_RULE.md` and the FOLLOW-087/100/101/102 specs
  still lack the reciprocal note telling Lane C implementers which exact key to write into
  `tenants.quizConfig`. The `quiz_enabled`→`enabled` drift this PR fixed is direct evidence the
  contract needs writing down before the next implementer repeats it. → folded into FOLLOW-125.
- **DG-2 (P3, advisory) — `--no-verify` commit-hook bypass is becoming routine in this repo** (used
  here for the unbuilt-workspace lint-error baseline). It is justified per-commit, but a standing
  pattern of bypassing the local lint gate erodes its value. No FOLLOW (this is a workflow/tooling
  observation for PM, not a code gap); noted for awareness — a `turbo run build` prelint or a
  documented lefthook skip rationale would remove the need.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (BLOCKED, `depends_on` includes FOLLOW-106) — POSITIVELY AFFECTED.** FOLLOW-117
  was the named precondition "must land before TICKET-PILOT-001 go-live" (QUEUE.md FOLLOW-117 notes).
  With the quiz key now armed, when PILOT-001 sets `pilot_frozen=true` at the shadow→live flip AND
  the pilot tenant has the quiz widget on, the `pilot_frozen_lane_c_active` warning WILL fire — so
  the go/no-go runbook can now (partially) rely on this signal for the quiz lane. **Carry-forward
  caution:** it remains inert for the intent-engine / generic / shadow-override keys (§3), so the
  RETRO-012 §5a runbook note ("do NOT treat 'no warning' as proof no Lane C feature is active") still
  holds for those three lanes until FOLLOW-125 lands. The migration-status caveat (0015 applied to
  prd only; dev/stg pending `DATABASE_URL_ADMIN`/ESC-010 — RETRO-012 LG-2) is **unchanged by this PR**
  and does not bear on the guard's _correctness_ — the fix is env-agnostic; the flip just must run
  against prd as already documented.
- **TICKET-PILOT-002 (go/no-go runbook, BLOCKED):** the manual Lane-C-off verification step
  RETRO-012 §5a recommended is still warranted as defense-in-depth for the three unwired keys; the
  quiz lane now has an automated backstop in addition.

#### 5b. Future sprint tickets affected

- **FOLLOW-102 (quiz toggle) — now the live, correctly-wired producer** for the `enabled` key; no
  further action for the quiz lane. **FOLLOW-087/100/101 (intent-engine toggles)** remain the
  unbuilt producers for `intent_engine_enabled`; when they land they MUST write that exact key into
  `tenants.quizConfig` (or FOLLOW-125 must reconcile). This PR does not change their specs but
  FOLLOW-125 should be referenced as their producer-contract precondition.

#### 5c. Contracts changed that other modules rely on

- N/A — the changed const is module-private and not exported; `tenants.quizConfig` shape is
  unchanged (the fix aligns the READER to the existing writer, it does not move the writer). The
  JSONB "untyped multi-tenant flag bag" drift surface RETRO-012 §5c flagged persists (two readers,
  different vocabularies) but is now one key less divergent. No Rule G mock sweep needed.

#### 5d. Architectural assumptions affected

- N/A — implementation now matches the Master Design / PILOT_FREEZE_RULE.md §Decision 3 intent
  (measurement-window guard is observability-only, non-blocking, fires when a Lane C feature is on).
  The fix brings the code _closer_ to the documented design rather than diverging from it.

### 6. New lesson candidates

- Pattern: **"consumer reads a config value under a key no producer writes"** (server-side flag-bag
  variant of Rule L) — seen in: RETRO-009, RETRO-011, RETRO-012 (counted at 3+), and now the
  _residual_ of RETRO-016. **Already codified as Rule L.** RETRO-012 explicitly decided Rule L
  covers this class and declined to mint a new rule; that decision stands. Current count is well past
  threshold but the class is owned — **do NOT double-promote.** No new rule.
- Pattern: **"a narrow fix closes the headline finding but leaves sibling ACs from the source retro
  open, and the ticket is marked DONE"** — seen in: RETRO-013/014/015 (Rule K.2 routes deferring
  consumer-side ACs to FOLLOW-122) and RETRO-016 (FOLLOW-117 deferring AC2/AC5 + 3 keys). Count ≥2,
  but this is a **PM/process observation (incomplete-AC carry-forward), not a code anti-pattern with
  a grep-able verification** — not a good fit for a CONVENTIONS_PATCH rule. Mitigation is procedural:
  the retro emits successor stubs (done here: FOLLOW-125/126). No rule promoted.
- Threshold to promote: 2 occurrences — Rule-L class is at 3+ but **already owned by Rule L**; the
  carry-forward class is not code-rule-shaped. **Net: no promotion.**

### 7. Follow-ups

- **FOLLOW-125** (backend-engineer, 1.5h, P2): reconcile the three remaining producer-less
  `LANE_C_FLAG_KEYS` (`lane_c_active`, `intent_engine_enabled`, `shadow_mode_override`) with real
  producers or remove the dead placeholders; document the `LANE_C_FLAG_KEYS`→producer contract in
  `PILOT_FREEZE_RULE.md` and cross-reference FOLLOW-087/100/101; add a producer-path integration
  assertion (carries RETRO-012 FOLLOW-117 AC2 + the three-key remainder + TG-1).
- **FOLLOW-126** (backend-engineer, 1.5h, P2): cache the per-request `pilot_frozen` tenant lookup on
  the `/api/adapt` hot path (short-TTL in-memory or Upstash) to drop the now-live DB round-trip
  (carries RETRO-012 CB-1 / FOLLOW-117 AC5).

### 8. Cross-references

- **Direct child of RETRO-012** (FOLLOW-106, PR #152) — this PR closes RETRO-012's §3 HALF_WIRE_C /
  §4a LG-1 / §4c TG-1 for the one key with a live producer, and inherits the two unsatisfied
  FOLLOW-117 ACs (now re-stubbed as FOLLOW-125/126). The migration-status (LG-2) and journal-timestamp
  (LG-3) findings from RETRO-012 are untouched and unaffected by this fix.
- **Rule L lineage:** RETRO-009 / RETRO-011 (SDK install-path producer-absence) — same anti-pattern
  class, server-side flag-bag variant. Rule L owns it; not re-promoted.
- **Carry-forward-AC sibling:** RETRO-013/014/015 (narrow fix, deferred sibling ACs → FOLLOW-122).

---

## RETRO-017 — FOLLOW-114 (emit data-inquiry-submit-selector in onboarding snippet) — 2026-05-27

### 1. Summary of change

- **PR:** #157 (merged 2026-05-26 21:58 UTC / 2026-05-26 23:58 +0200, commit `f882dae`; squash of 2
  commits — the core fix + a CI-lint cleanup that removed an unnecessary type assertion and the
  local-only eslint-disable comments).
- **Files changed:** 3 (+128 / −4). `apps/control-plane/src/components/onboarding/DetectionPreview.tsx`
  (+22/−4, the production fix), its `.test.tsx` sibling (+93, 7 unit + 3 integration tests), and
  `packages/shared/src/tenant-site-schema.ts` (+13, the new typed field).
- **Modules touched:** control-plane (onboarding wizard) + shared (`TenantSiteSchema` type). **No SDK
  runtime / ingest / decision-api / data / db-migration / docs / config code touched** — the SDK
  consumer side was already complete (FOLLOW-097, PR #151).
- **Key contracts changed:**
  - `TenantSiteSchema.inquiry_submit_selector?: string | null`
    (`packages/shared/src/tenant-site-schema.ts:249`) — **added, optional** — breaking: no. The field
    was already persisted in the `tenant_site_schemas.schema` JSONB at the DB level; this only adds the
    TS type. (Note the `| null` variance vs. the SDK's `SdkConfig.inquirySubmitSelector?: string` —
    see §4b CB-1.)
  - `buildSnippet(tenantId, apiKey, inquirySubmitSelector?: string | null)`
    (`DetectionPreview.tsx:115`) — **third param added, optional** — breaking: no (existing 2-arg
    callers unaffected). Emits `data-inquiry-submit-selector="<sel>"` when the arg is a non-null
    string; omits the attribute entirely when null/undefined.
  - `DetectionPreview` call site (`DetectionPreview.tsx:173`) — now passes
    `schema.inquiry_submit_selector` into `buildSnippet`. This is **the producer wire RETRO-011 §3
    flagged as the missing HALF_WIRE_C** for the schema→snippet hop.

### 2. Verification done in PR

- Test files changed: **1** (`DetectionPreview.test.tsx`, +93). 7 new unit tests on `buildSnippet`
  (selector present → attribute emitted; 2-arg call / explicit `null` / explicit `undefined` → attribute
  omitted) + 3 new integration tests that `render(<DetectionPreview schema={...}/>)`, click
  **Save & activate**, and assert the rendered `<code>` block does / does not contain
  `data-inquiry-submit-selector=` for schema-with-selector / schema-null / schema-field-absent.
- Assertions added: ~14 across 10 tests.
- Coverage delta: positive on `DetectionPreview.tsx` (both `buildSnippet` branches + both call-site
  branches covered). PR body reports 604 control-plane tests pass (up from 599).
- **Rule L verdict — PASS for the schema→snippet hop.** The 3 integration tests drive the REAL
  `buildSnippet()` via the rendered component and the activate flow (not a hand-written string), and
  assert the attribute is present/absent based on the `schema` prop. This is exactly the Rule L
  evidence RETRO-011 §4c TG-1 demanded ("a test that injects the value is not evidence"). The unit
  tests additionally pin `buildSnippet` directly. ✅
- CI checks: passed at merge per QUEUE.md (Wave-3 / Lane A, `f882dae`; pre-existing-red Rule I /
  Vercel / Python lanes non-blocking per QUEUE preamble). The 2nd commit removed a
  `no-unnecessary-type-assertion` cast and stale local-only eslint-disable directives that became
  unused-directive errors in CI — a clean fix, no behavior change.

### 3. Wiring Audit

- **HALF_WIRE_C** — `schema_field:inquiry_submit_selector` (the upstream detection→schema producer) —
  consumer now at `apps/control-plane/src/components/onboarding/DetectionPreview.tsx:173`
  (`buildSnippet(..., schema.inquiry_submit_selector)`) — **NO production producer populates the field
  on a real detected schema** — priority **P0** → **FOLLOW-127**.

  Detail: this PR correctly closes the schema→snippet hop RETRO-011 flagged (and the SDK consumer chain
  `data-inquiry-submit-selector` → `config.ts:99` → `index.ts:384` → `observer.ts:146` is verified
  complete this retro). BUT the field `schema.inquiry_submit_selector` that `buildSnippet` now reads is
  itself produced by **nobody** in production. Producer search this retro:
  - `grep -rn "inquiry_submit_selector" apps/control-plane/src --include="*.ts" --include="*.tsx" | grep -v .test.`
    returns ONLY the `DetectionPreview.tsx` consumer (lines 116/169/173) — the detect route
    (`api/detect/route.ts`), the activate route (`api/schema/activate/route.ts`), and the
    `tenant-schema.ts` lib never write it.
  - `grep -rln "inquiry" apps/ --include="*.py" | grep -v .test.` (Modal/Python detection apps) →
    **zero matches.**
  - `grep -rn "inquiry_submit_selector" packages/sdk/src/auto-detect --include="*.ts"` (excluding
    `__fixtures__` and tests) → **zero matches.** The auto-detect engine emits only
    `index_schema.card_field_mappings` and `detail_schema.slot_selectors` (per
    `api/detect/route.ts:119-141`); it never detects an inquiry submit selector.
  - The ONLY place the field is set is the hand-authored fixture
    `packages/sdk/src/auto-detect/__fixtures__/000-app-estalara/detail-ground-truth.json:19` and the
    new test mocks in `DetectionPreview.test.tsx`.

  Net effect: the FOLLOW-097 → FOLLOW-114 chain is now closed end-to-end **for the pilot tenant**
  (whose `000-app-estalara` schema carries the selector via the fixture / a hand-set value), but for
  ANY other onboarded tenant `schema.inquiry_submit_selector` is `undefined`, the snippet omits the
  attribute, and `inquiry.started` still never fires. The half-wire RETRO-011 located at schema→snippet
  is resolved; the residual has moved **one hop further upstream to detection→schema**. Consumer-reads-
  data-never-produced ⇒ HALF_WIRE_C ⇒ **P0** (a launch metric depends on it; see §5). This is the same
  Rule L anti-pattern class, now at the detection-engine layer.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P0, central) — detection never produces `inquiry_submit_selector` (see §3 HALF_WIRE_C).**
  The auto-detection engine (deterministic L1–L10 + LLM fallback) extracts index-card and detail-slot
  selectors but has no rule/heuristic to locate the inquiry-form submit button, and neither the
  `/api/detect` nor `/api/schema/activate` route synthesizes or persists the field. So for a generic
  tenant the value is structurally absent. → **FOLLOW-127** (detection-engine rule + persistence).
  This is the third+ instance of the Rule L family (RETRO-009/010/011) extended to the
  detection→schema producer; Rule L already owns it, so no re-promotion (see §6/§9).

#### 4b. Code bugs not caught

- **CB-1 (P3, type-variance, latent) — `| null` vs. `undefined`-only variance across the wire.**
  `TenantSiteSchema.inquiry_submit_selector` is `string | null` (shared), `buildSnippet`'s param is
  `string | null` (and uses `!= null` to coalesce both — correct), but `SdkConfig.inquirySubmitSelector`
  is `string | undefined` (no `null`). The attribute is only emitted as a non-empty string so the SDK
  never receives `null` or `""` over the wire today — but if a future producer ever wrote `null` into
  the *snippet* (e.g. a refactor that drops the `!= null` guard), `data-inquiry-submit-selector="null"`
  would become a literal selector and `document.querySelector("null")` would throw / never match. The
  current guard makes this safe; flagged as a latent foot-gun, not an open defect. No FOLLOW (covered
  by the `buildSnippet` unit tests + the empty-string-not-tested note in 4c).

#### 4c. Test coverage gaps

- **TG-1 (P2) — no test pins behavior for an empty-string `inquiry_submit_selector`.** Tests cover
  non-empty-string / `null` / `undefined` / absent, but not `""`. With `!= null`, an empty string would
  emit `data-inquiry-submit-selector=""`, the SDK guard `if (inquirySubmitSelector && ...)`
  (`observer.ts:147`) would treat `""` as falsy and skip registration — benign, but undocumented and
  untested. Low priority; fold into FOLLOW-127 (the detection producer should never emit `""`). No
  separate stub.
- **TG-2 (P2) — the SDK-emitted `inquiry.started` Zod-contract test (FOLLOW-115) is still open.**
  RETRO-011 §4c TG-2 stubbed FOLLOW-115; unchanged by this PR. Once FOLLOW-127 makes the event fire for
  real tenants, FOLLOW-115 becomes more load-bearing. No new stub (FOLLOW-115 already exists).

#### 4d. Documentation gaps

- **DG-1 (P3) — `inquiry_submit_selector` / `data-inquiry-submit-selector` still absent from the
  Master Design §B.1 SDK-config-surface table and the SDK install/snippet docs.** Same omission RETRO-011
  DG-1 / RETRO-010 DG-2 flagged → fold into the FOLLOW-071 SDK-config-surface doc sweep. The new shared
  `TenantSiteSchema` field is well-documented in code (TSDoc references FOLLOW-097/114), but the canonical
  config-surface table is not updated. No new stub.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13b Lane B, BLOCKED, gated by FOLLOW-114) — MOST AFFECTED, now UNBLOCKED
  for the pilot tenant only.** FOLLOW-114 is in PILOT-001's `depends_on`; the wizard snippet path now
  emits the attribute, so the WIZARD-onboarded pilot will fire `inquiry.started` IF the activated
  `000-app-estalara` schema carries the selector. **PM action (carry-forward, not new):** PILOT-001 still
  needs (i) the existing RETRO-011 §5a manual-install AC — the hand-written SvelteKit `+layout.svelte`
  must emit `data-inquiry-submit-selector="[data-estalara-slot='inquiry-submit']"` (the wizard fix does
  NOT cover the manual path; this pairs with the RETRO-010 `data-decision-url` AC); AND (ii) a shadow-mode
  smoke assertion that `inquiry.started` rows land in ClickHouse. Confirm the pilot schema actually carries
  the selector value (since detection won't produce it — §3) — for the pilot this must be set by hand or
  via FOLLOW-127. The §3 HALF_WIRE_C does NOT block PILOT-001 *if* the pilot schema is hand-set, but it
  DOES block any general-tenant onboarding.
- **TICKET-PILOT-002 (go/no-go runbook, BLOCKED) — its "inquiry.started observed in ClickHouse during
  shadow mode" gate (RETRO-009 §5a) remains the single check that would catch §3 before go-live.** Still
  load-bearing; confirm present.
- **FOLLOW-092 (inquiry-starts mock → real / shadow validation, BLOCKED on PILOT-001) — directly
  COUPLED.** Replacing the inquiry-starts mock with real data is pointless until `inquiry.started`
  actually flows. FOLLOW-092's precondition should read "FOLLOW-097 + FOLLOW-114 + FOLLOW-127 shipped (or
  pilot schema hand-set) AND `inquiry.started` rows present in ClickHouse for the pilot tenant."
- **Wave-3 dashboard fixes (FOLLOW-093/094/098, DONE/READY) — not affected by this control-plane wizard
  change.** Thematically, FOLLOW-098 (inquiry-starts fail-loud + provenance, PR #155) means a dashboard
  showing mock inquiry data is now LABELED as mock — a defense-in-depth that would surface §3 to a human
  at go/no-go. No spec change.

#### 5b. Future sprint tickets affected

- **FOLLOW-115 (P2, RETRO-011, Sprint 14):** the Zod-contract test for the SDK `inquiry.started` payload
  — unchanged; becomes more meaningful once events fire for real tenants (post FOLLOW-127).
- **FOLLOW-091 (inquiry-starts mock → real, backlog):** precondition now extends to FOLLOW-127 (detection
  must populate the field) in addition to FOLLOW-097/114.
- **FOLLOW-127 (this retro):** the detection→schema producer; should land before general-tenant
  onboarding GA (not strictly before the single hand-set pilot, but before any self-serve onboarding).

#### 5c. Contracts changed that other modules rely on

- `TenantSiteSchema` gained an optional field — backward compatible; no existing consumer relied on a
  changed contract. The `schema` JSONB already carried the key at the DB level, so persisted rows are
  unaffected (the type now just describes reality). The SDK `SdkConfig`, `setupObservers`, `observer.ts`
  contracts are unchanged (FOLLOW-097 already shipped them).
- `inquiry.started` remains a registered `@estalara/shared` event consumed by `cta-lift/route.ts`
  (funnel) and `inquiry-starts/route.ts`. Producers/consumers downstream of the attribute were ready
  before this PR; only the detection→schema producer (§3) remains.

#### 5d. Architectural assumptions affected

- **Master Design §B.9 (detected-schema-drives-runtime-SDK-behavior):** RETRO-011 §5d called this
  assumption "only partially realized — runtime consumer built, schema→runtime producer not." This PR
  builds the schema→snippet producer (one half of the missing hop), so the loop is closed
  schema→snippet→SDK→event. The remaining unrealized piece is **detection→schema** (§3): the engine that
  is supposed to *fill* the schema with this selector does not. So §B.9 is now realized for the
  *transport* of the field but not its *derivation*. FOLLOW-127 closes the loop fully. No Master Design
  edit beyond DG-1's config-surface table.

### 6. New lesson candidates

- **Pattern (Rule L family) — "the production path that PRODUCES a config value the consumer reads is
  absent; tests/fixtures inject it, so green CI masks a dead wire."** This retro is the **fourth**
  occurrence (RETRO-009 SDK init call site; RETRO-010 manual `+layout.svelte`; RETRO-011 snippet
  generator; RETRO-017 detection→schema). **Already codified as Rule L** (threshold met at RETRO-011;
  evidence RETRO-009/010/011). This retro is fresh evidence at a NEW layer (the detection engine, one hop
  upstream of the install snippet) — the lesson is that Rule L must be applied **transitively**: closing
  consumer←producer at one hop can simply relocate the half-wire to producer←producer-of-the-producer.
  **No re-promotion** (Rule L already owns the class); recommend a one-line Rule L evidence/scope note be
  appended by a future retro IF a fifth transitive-relocation case appears. Count for the *transitive*
  sub-variant alone: 1 (this retro) — below threshold; track.
- No other repeating pattern surfaced this retro.

### 7. Follow-ups

- **FOLLOW-127** (P0, ml-engineer + backend-engineer, 4h, Sprint 13b/14 — before self-serve onboarding
  GA): make the production detection→schema path PRODUCE `inquiry_submit_selector`. Add an
  auto-detection rule/heuristic (deterministic selector probe for inquiry/contact form submit buttons,
  LLM fallback) that populates `TenantSiteSchema.inquiry_submit_selector`, persist it through
  `/api/detect` + `/api/schema/activate` into `tenant_site_schemas.schema`, and add a test that a
  detected real-tenant schema (not a hand-set fixture) carries the field so `buildSnippet` emits the
  attribute. Closes §3 HALF_WIRE_C + §4a LG-1; folds §4c TG-1 (never emit `""`). For the single pilot
  tenant, the field may be hand-set as an interim unblock (note this in PILOT-001).

### 8. Cross-references

- **Direct child of RETRO-011 (FOLLOW-097, PR #151)** — RETRO-011 §3 flagged the schema→snippet
  HALF_WIRE_C and stubbed FOLLOW-114 (this ticket); RETRO-011 promoted Rule L for exactly this
  install/snippet sub-case. This PR closes that specific hop (Rule L PASS for schema→snippet, §2) and
  surfaces the next-upstream residual (detection→schema, §3 → FOLLOW-127). The FOLLOW-097 → FOLLOW-114
  chain is now end-to-end closed for the transport; FOLLOW-127 closes the derivation.
- **RETRO-009/010 (Rule L lineage)** — same anti-pattern, earlier hops (SDK init call site; manual
  install). Rule L owns the class; not re-promoted here.
- **RETRO-013/014/015/016 (this merge wave)** — independent control-plane fixes (cta-lift / inquiry-starts
  routes, pilot_frozen guard); no overlap with this SDK/onboarding change. RETRO-016 is the nearest
  sibling Rule-L-family case (server-side flag-bag producer-absence variant), reinforcing that Rule L
  recurs across layers.

---

## RETRO-018 — FOLLOW-118/119/120/121 (YELLOW audit Sprint 1: F-02 cold-start prior, F-09 locale copy, F-10 LLM attribution, F-13/F-14 GDPR LIA) — 2026-05-27

### 1. Summary of change

- **PR:** #158 (merged 2026-05-27 14:16 UTC / 16:16 +0200, commit `6827305`). Branch
  `claude/intelligent-dirac-3mBS1` — **NOT** an agent-prefix branch; this is the separate "YELLOW
  audit" launch-readiness track with its own `F-NN` numbering (F-02/09/10/13/14), recorded in
  QUEUE.md under reserved FOLLOW-118/119/120/121 so the queue stays the status SoT. Commit title
  references `[TICKET-PILOT-001]` but the work is the YELLOW Sprint-1 bundle, not PILOT-001 itself.
- **Files changed:** 9 (+201 / −17). 6 SDK (`index.ts`, `core/config.ts`, `core/adapt.ts`,
  `ui/consent-banner.ts`, `ui/quiz-trigger.ts`, `ui/quiz-widget.ts`), 2 control-plane
  (`api/adapt/route.ts`, `lib/llm-gateway.ts`), 1 docs (`compliance/dpia.md`, +111 docs-only).
- **Modules touched:** SDK + control-plane (adapt route + llm-gateway) + docs (compliance). No
  ingest / decision-api / data / db-migration / config touched. **Multi-concern bundled PR** — four
  unrelated YELLOW items in one squash; analyzed per-item below.
- **Key contracts changed:**
  - `SdkConfig.language` — `'en' | 'pl'` → `'en' | 'pl' | 'es'` (`core/config.ts:21`) — widened —
    breaking: no (additive union member; `readConfig` defaults unknown values to `'en'`). Same
    widening mirrored on `ConsentBannerOptions.language`, `QuizTriggerConfig.language`,
    `QuizWidgetConfig.language`.
  - `runDecisionTree(...)` (`api/adapt/route.ts:209`) — signature changed: `_sessionId` (unused) →
    `sessionId` + new `tenantId` + new `locale: 'en'|'pl'|'es' = 'en'` params inserted **before**
    `listingContext` — module-private fn, not exported — breaking: no external surface, but
    **positional-arg ordering is now load-bearing** (see §4b CB-1). Both call sites updated (GET
    line 586, POST line 766).
  - `AdaptPostBodySchema.locale: z.enum(['en','pl','es']).optional()` (`route.ts:187`) — added,
    optional — breaking: no. Plus GET reads `?locale=` query param (`route.ts:510`).
  - `LlmGatewayInput.sessionId?` / `LlmGatewayInput.tenantId?` (`lib/llm-gateway.ts:42-44`) — added,
    optional — breaking: no. `logLlmCallAsync` now records `input.sessionId ?? 'unknown'` /
    `input.tenantId ?? 'unknown'` instead of hardcoded `'unknown'`.
  - `docs/compliance/dpia.md` §13.1 + §13.2 — appended LIA sections — docs-only, no code contract.

### 2. Verification done in PR

- Test files changed: **NONE.** Zero test files in the diff (verified `git show 6827305 --stat` — no
  `*.test.ts` / `*.spec.ts`). This is the single largest verification gap of the merge: four
  behavior changes shipped with no automated assertions. The PR "Test plan" is a manual checklist
  (PL/ES copy, ClickHouse id grep, staging cold-start comparison) — none automated.
- Assertions added: **0.**
- Coverage delta: **negative** (net new branches in `runDecisionTree` locale selection,
  `readConfig` es-branch, the F-02 try/catch block, and the llm-gateway id coalescing are all
  uncovered).
- CI checks: merged with Lane A gates green per QUEUE.md (`6827305`, marked DONE / CI green for all
  four FOLLOW-118..121). Note the standing CI-gate-landscape caveat (Rule I / Vercel / Python lanes
  pre-existing-red & non-blocking) — green here means the real merge gates passed, not full-suite.
- **Rule L verdict:** the F-02 and F-10 wires DO connect real producers to real consumers in
  production code (not test-injected), so they pass the Rule L producer-existence bar at the wire
  level. But with zero tests, there is no Rule-L-style evidence that the wires behave correctly —
  see §4c.

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- F-02 imports `applyArchetypeHints` (`core/intent.ts:591`), `detectSiteSchema`
  (`auto-detect/pipeline.ts:73`), `extractArchetypeHints` (`auto-detect/archetype-hints.ts:426`)
  into `index.ts` and INVOKES all three in `init()` (lines 164/166/168). All three previously
  existed and were exported via the `auto-detect` barrel + consumed by `api/detect/route.ts:339`
  (`detectSiteSchema`) and `pipeline.ts:117` (`extractArchetypeHints`); `applyArchetypeHints` was
  previously defined-but-uninvoked at init — **F-02 closes that latent dead-path** (the exact
  "implemented but never invoked at init" class the audit was created to catch). No NEW production
  symbol added that lacks a non-test importer. **CHECK A clean.**
- F-09 Spanish `COPY.es` / `QUIZ_LABELS.es` / `QUIZ_CONTENT.es` objects are consumed by the same
  language-switch render paths that already consume `.pl` (`renderConsentBanner` etc.) — live once a
  tenant sets `data-language="es"`. Not dead.

**CHECK B — Half-wire detection:**

- **F-10 — `LlmGatewayInput.sessionId`/`tenantId`: PRODUCER + CONSUMER both present, wire complete.**
  Producer = `runDecisionTree` passes `sessionId`/`tenantId` into BOTH `callLlmGateway(...)` calls
  (`route.ts:249-250` and `:268-269`); consumer = `logLlmCallAsync({ sessionId: input.sessionId ??
'unknown', ... })` (`llm-gateway.ts:392`). Verified `logLlmCallAsync` has exactly ONE call site
  (`llm-gateway.ts:392`) and `callLlmGateway` (control-plane) has exactly TWO call sites, both in
  `route.ts`, both now pass the ids. **No remaining `'unknown'` path in the control-plane adapt
  flow.** ✅ (Caveat: the `?? 'unknown'` fallback still fires if a future caller omits the optional
  fields — see §4b CB-2; and the separate `apps/decision-api/src/lib/llm-gateway.ts` is a DIFFERENT
  gateway not touched here — out of scope, not a regression.)
- **F-09 — `locale` field: PRODUCER + CONSUMER both present end-to-end.** SDK producer =
  `fetchDirectives` adds `locale: config.language` to the POST body (`adapt.ts:502`); server
  consumer = `AdaptPostBodySchema.locale` parses it (`route.ts:187`) → `runDecisionTree` selects
  `(locale === 'pl' ? s.pl : locale === 'es' ? s.es : undefined) ?? s.en` (`route.ts:231`). GET path
  also wired (`?locale=` query → `route.ts:510`). **Wire complete both transports.** ✅
- **HALF_WIRE — documentation kind (F-13/F-14): the DPIA §13.1/§13.2 mandate consent-banner
  disclosure strings that DO NOT EXIST in the SDK banner.** This is the central finding of this
  retro and the precise "doc that describes a banner string that doesn't exist" pattern. Detail:
  - DPIA §13.1 (consent-denial logging) requires the banner/Privacy Notice to state _"We record the
    fact of your consent decision — including a denial — for compliance and debugging purposes. This
    log is retained for 7 days..."_ — **mandatory before EU pilot go-live.**
  - DPIA §13.2 (90-day cross-session fingerprint) requires the banner to state _"To remember your
    preferences across visits, we store a pseudonymous identifier in your browser for up to 90 days.
    This identifier rotates monthly and is deleted if you withdraw consent."_ — and explicitly: the
    F-14 LIA **balancing test passes _only if_ this disclosure gap is remediated** ("conditional on
    remediation of the consent banner disclosure gap"). The DPIA itself states the lawful basis is
    not satisfied until the banner is updated.
  - Actual shipped banner copy (`ui/consent-banner.ts:113-126`, all three locales) says only "We
    personalize this page based on your browsing behavior." / "Personalizujemy tę stronę..." /
    "Personalizamos esta página...". **Neither the denial-logging disclosure nor the 90-day
    identifier disclosure exists in any locale.** The `consent.denied` event IS dispatched in
    production (`index.ts:122`), so the §13.1 processing the LIA legitimizes is live while the
    required disclosure is absent.
  - Classification: a documented control (banner disclosure language) whose runtime counterpart is
    not implemented — a **compliance HALF_WIRE_C** (the DPIA "consumer" expects a banner string the
    SDK "producer" never renders), priority **P0** because the DPIA explicitly conditions the F-14
    lawful basis on it and gates it "before EU pilot go-live" → **FOLLOW-128** (SDK banner copy) +
    **FOLLOW-129** (tenant Privacy Notice template + DPO sign-off tracking). Note: F-13/F-14 were
    scoped "Option B — documentation only, no code," which is internally consistent for *this PR*,
    but the docs they added create a NEW code obligation that has no ticket and no
    `depends_on`-before-go-live wire. The doc-only decision did not emit the implementation
    successor — this retro emits it.
- No new env var, DB column, Redpanda topic introduced. (F-10 writes existing ClickHouse columns
  `session_id`/`tenant_id` with real values instead of literals — not a new column.)

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P1, forward-looking cascade) — F-02 cold-start prior risks DOUBLE-APPLICATION when Lane C
  FOLLOW-100/101 land.** `applyArchetypeHints` (`intent.ts:591`) additively boosts
  `state.probabilities` per archetype then re-normalizes, mutating the same `IntentState` that
  `applyQuizPrior` and the future `applyChatIntentPrior` (FOLLOW-100) compound onto. F-02 runs once
  in `init()` and persists into `currentIntentState`, which all subsequent priors build on — correct
  for a one-shot cold-start seed. The risk is twofold: (i) if FOLLOW-100/101's prior math
  independently derives a site-structure signal, the site-type contribution is counted twice; (ii)
  if `init()` re-runs on session resume (SDK re-mount / SPA route change), the hint boost is
  re-applied to an already-boosted state. QUEUE.md FOLLOW-118 notes explicitly flag this ("confirm
  no double-application of priors when Lane C lands") and TICKET-AUTO-007 overlaps conceptually.
  Not a current bug (Lane C is BLOCKED/unbuilt; F-02 is the sole prior source today), but a
  load-bearing integration constraint that MUST be encoded before FOLLOW-100/101 merge. →
  **FOLLOW-130** (P1): document + test the prior-composition order (cold-start hint → quiz →
  chat-intent) and assert idempotency of the F-02 seed across re-init. Cross-ref FOLLOW-100/101
  specs as a precondition.
- **LG-2 (P2) — F-02 runs `detectSiteSchema(document.documentElement.outerHTML, ...)` synchronously
  in the init critical path (awaited) before the DQS tracker / first event.** It is try/caught so it
  cannot throw, but it is `await`ed — a slow DOM serialization + detection on a large page delays
  session init and the first behavioral event. The try/catch swallows failures silently (empty
  catch), so a detection regression is invisible (no telemetry on hint-application rate). Per the
  comment, AI Vision is excluded from the browser bundle so this is DOM-pattern-only (bounded), but
  there is no timing guard and no observability. → folded into FOLLOW-130 (add a hint-applied
  counter / debug signal so staging can verify the prior actually shifted — the PR's own manual test
  plan item "compare currentIntentState distributions" is currently unobservable in prod).

#### 4b. Code bugs not caught

- **CB-1 (P2, latent) — `runDecisionTree` positional-arg ordering is now a foot-gun.** The signature
  is `(archetypeId, confidence, similarity, sessionId, tenantId, locale, listingContext)` — seven
  positional args, four of them `string`/`string`-union in a row (`sessionId, tenantId, locale`).
  The POST call passes `body.session_id, body.tenant_id, body.locale ?? 'en', listingContext`
  (correct); GET passes `sessionId, tenantId, locale` (correct, no listingContext → defaults `{}`).
  But a future edit that transposes `sessionId`/`tenantId` would silently mis-attribute every
  ClickHouse cost row (both are strings, TS won't catch it) and there is no test pinning the order.
  No current defect (both sites verified correct this retro). → consider an options-object refactor;
  folded into FOLLOW-131 (the F-10 attribution test) as a regression guard rather than a separate
  stub.
- **CB-2 (P3, latent) — the `?? 'unknown'` fallback in `logLlmCallAsync` is now the ONLY thing
  preventing a crash if a caller omits the optional `sessionId`/`tenantId`.** Because the fields are
  `optional` on `LlmGatewayInput`, the type system does not force callers to supply them; the
  control-plane GET-path call site SETS `tenantId` from `getAuthClaims ?? x-tenant-id ?? 'unknown'`
  — so a JWT-less, header-less SDK call STILL logs `tenantId: 'unknown'`. F-10's goal ("no more
  'unknown'") is therefore achieved only for authenticated/header-bearing calls; anonymous SDK
  adapt calls without `x-tenant-id` still produce `'unknown'` cost rows. Partial by design, but the
  PR body claims unqualified "real identifiers instead of 'unknown'". → noted; FOLLOW-131 should
  assert the `'unknown'` fallback is exercised only on the genuinely-anonymous path.

#### 4c. Test coverage gaps

- **TG-1 (P1) — ZERO tests for any of the four items.** This is the dominant gap. Concretely needed:
  (a) F-09: a control-plane test asserting `runDecisionTree` returns `s.pl`/`s.es` when locale set
  and falls back to `s.en` when a slot lacks the override (the `?? s.en` path — proves it can't
  throw on a pl/es-less slot); (b) F-09 SDK: `readConfig` maps `data-language="es"` → `'es'` and
  unknown → `'en'`; (c) F-10: `callLlmGateway` threads `sessionId`/`tenantId` into
  `logLlmCallAsync` (the attribution wire — mock `logLlmCallAsync`, assert real ids passed); (d)
  F-02: `init()` applies `applyArchetypeHints` to `currentIntentState` when `detectSiteSchema`
  returns a schema, and is a no-op when detection throws/returns empty. → **FOLLOW-131** (P1, the
  F-09/F-10 control-plane + SDK-config tests) + the F-02 idempotency test folded into FOLLOW-130.
- **TG-2 (P2) — no test that the locale fallback chain is total.** `s.en` is the canonical slot
  value (always present per the playbook contract, confirmed `route.ts:228` pre-change comment
  "English locale as canonical value"), so `?? s.en` cannot yield `undefined` — but this invariant
  ("every playbook slot has a non-empty `.en`") is unasserted. If a future playbook slot ships
  without `.en`, every locale silently emits `undefined`. Fold into FOLLOW-131.

#### 4d. Documentation gaps

- **DG-1 (P2) — the new `es` locale and `locale` adapt-route param are absent from Master Design
  §B.1 SDK-config-surface table and the SDK install/snippet docs** (same config-surface omission
  RETRO-010/011/017 repeatedly flag → FOLLOW-071 sweep). The `data-language="es"` option and the
  `/api/adapt?locale=` contract are now live but undocumented in the canonical surface. Fold into the
  existing FOLLOW-071 config-surface doc sweep; no new stub.
- **DG-2 (P1, compliance) — the DPIA §13.1/§13.2 disclosure obligations are not reflected in any
  tenant-facing artifact or the SDK banner** (the §3 HALF_WIRE). The DPIA records "DPO review
  pending" and "Action owner: Compliance Engineering + SDK Engineer" with due "before EU pilot
  go-live" but no ticket carries it. → FOLLOW-128/129 (see §7); this is the implementation half of
  the doc-only Option B decision.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13b Lane B, BLOCKED) — F-02/F-09/F-10 are net-positive launch-readiness
  wires for it, but the §3 compliance HALF_WIRE is a NEW go-live BLOCKER for EU traffic.** The pilot
  runs on app.estalara.com; if any pilot traffic is EU-resident, the DPIA's own text says the F-14
  lawful basis for the 90-day fingerprint is NOT satisfied until the banner discloses it (§13.2
  balancing test "passed only if the disclosure gap is remediated"). PM must treat FOLLOW-128 as a
  PILOT-001 EU-go-live precondition (or scope the pilot to non-EU / non-fingerprint Mode A). This
  is a compliance escalation candidate — flagging here per constraint 3 for PM to escalate.
- **TICKET-PILOT-002 (go/no-go runbook, BLOCKED) — its go-live checklist must add a "consent banner
  discloses §13.1 denial-logging + §13.2 90-day identifier (or pilot is Mode-A / non-EU)" gate.**
  Currently no runbook item would catch the §3 gap before launch.
- **Wave-3 / RETRO-013..017 siblings (DONE/READY) — F-09/F-10 both touch `api/adapt/route.ts`, the
  SAME file FOLLOW-117 (RETRO-016, pilot_frozen guard) and the cta-lift/inquiry-starts vocabulary
  work neighbor.** Verified the merged route is internally consistent: the locale selection (line
  231), the F-10 attribution threading (lines 249/268), the pilot_frozen guard
  (`checkPilotFrozenAsync`, post-merge still fires), and the fail-loud ClickHouse behavior all
  coexist — the F-10 refactor MOVED the `tenantId` resolution EARLIER (GET line 508, was line ~608)
  so it is available before `runDecisionTree`; the old later-block was deleted (verified in diff, no
  duplicate `const tenantId`). The `checkPilotFrozenAsync(tenantId, ...)` call still receives the
  (now earlier-resolved) `tenantId`. No conflict.

#### 5b. Future sprint tickets affected

- **FOLLOW-100 / FOLLOW-101 (Lane C, BLOCKED, sdk/ml-engineer) — directly affected by F-02 (see §4a
  LG-1).** Their prior math will compose with the F-02 cold-start seed. Their specs (to-author at
  spawn) MUST reference the prior-composition order and the idempotency constraint so the site-type
  contribution isn't double-counted. FOLLOW-130 is the precondition that documents this.
- **TICKET-AUTO-007 (archetype hints from site structure, in QUEUE) — conceptual overlap with F-02.**
  F-02 already invokes the `extractArchetypeHints` → `applyArchetypeHints` chain at SDK init; AUTO-007
  must not build a second, divergent site-structure-prior path. Reconcile at AUTO-007 spawn.
- **Remaining YELLOW Sprint 2-4 (F-01/04/05/06/07/08 + UX-01 + measurement dashboard) — outside the
  FOLLOW-NNN system,** tracked on the root-owned YELLOW plan. FOLLOW-128/129 (banner disclosure) are
  arguably YELLOW-track compliance items but are emitted here as FOLLOW-NNN because they are
  retro-discovered go-live blockers; PM should reconcile whether they belong on the YELLOW plan or
  the FOLLOW queue (avoid double-tracking).

#### 5c. Contracts changed that other modules rely on

- `SdkConfig.language` widened to include `'es'` — additive, backward compatible; all four consuming
  UI types widened in lockstep (verified). No Rule G inline-mock sweep needed (union widening, not a
  required-field add).
- `runDecisionTree` is module-private (not exported) — the signature change has no cross-module
  surface; both in-file call sites updated. No external consumer.
- `LlmGatewayInput` gained two OPTIONAL fields — no existing caller breaks; the
  `apps/decision-api/src/lib/llm-gateway.ts` is a separate type/gateway and is unaffected (and still
  lacks attribution — out of scope for F-10, which targeted control-plane only).

#### 5d. Architectural assumptions affected

- **Master Design cold-start / Bayesian-prior model:** F-02 realizes the "site-type informs the
  cold-start prior before the first event" assumption that was previously dead code
  (`applyArchetypeHints` defined, never invoked at init). This brings the implementation CLOSER to
  the documented intent. The open architectural question (§4a LG-1) is the COMPOSITION rule across
  the three prior sources (site-hint / quiz / chat-intent) — Master Design §D.1.1/§D.6 (FOLLOW-100's
  reference) should state the order and idempotency explicitly; currently implicit.
- **GDPR / DPIA assumption:** §13.2 documents that the system's actual behavior (90-day cross-session
  fingerprint, live `consent.denied` dispatch) outran its disclosed behavior. The DPIA now records
  the gap and conditions lawfulness on closing it — so the architecture is documented-but-not-yet-
  compliant for EU until FOLLOW-128 lands. This is the inverse of the usual half-wire: the doc is
  ahead of the code, and the doc itself says the code is non-compliant until it catches up.

### 6. New lesson candidates

- **Pattern A — "documentation/compliance control specifies a runtime string the code never
  renders" (documentation HALF_WIRE_C).** Seen in: RETRO-018 (DPIA-mandated banner copy absent from
  SDK). Prior retros flag *code*-side producer-absence (Rule L family, RETRO-009/010/011/017) and
  *config-bag* producer-absence (RETRO-016), but a **DPIA/doc that prescribes a banner disclosure
  string with no implementing code** is a distinct sub-shape. Count for THIS specific shape:
  **1** (this retro). Below the threshold of 2 → **NOT promoted.** Track: if a second
  "compliance-doc-prescribes-u,nimplemented-UI-string" case appears, promote a rule "Compliance docs
  that mandate user-facing copy MUST emit an implementation FOLLOW with a before-go-live
  `depends_on`, and the retro verifies the string exists in the SDK." For now Rule L's spirit
  (verify the producer of a thing a consumer expects actually exists) covers it transitively — the
  "consumer" is the DPIA's go-live gate.
- **Pattern B — "multi-item bundled PR ships behavior changes with zero tests."** Seen in: RETRO-018
  (4 items, 0 tests). This is a verification-discipline observation, not a grep-able code
  anti-pattern, and it is somewhat track-specific (the YELLOW audit branch is not agent-prefix and
  may run looser test gates than the FOLLOW-NNN sprint flow). Count as a code rule: not rule-shaped.
  No promotion; surfaced for PM as a process note (the YELLOW track should adopt the same
  test-with-the-fix discipline as the FOLLOW-NNN flow).
- **Rule L family (test/fixture-injected value masks a dead production wire):** does NOT recur in
  this PR — F-02 and F-10 wires ARE production-to-production (verified §3), so this retro is a
  COUNTER-example reinforcing that the wires are real. No re-promotion.
- Threshold check: no pattern reaches 2 occurrences in the prior 5 retros (RETRO-013..017) for the
  new shapes here. **Net: no rule promoted.**

### 7. Follow-ups

- **FOLLOW-128** (compliance-engineer + sdk-engineer, 2h, **P0**, before EU pilot go-live): implement
  the DPIA §13.1 + §13.2 mandated consent-banner disclosures in `ui/consent-banner.ts` (all three
  locales) — denial-logging notice + 90-day cross-session-identifier notice — closing the §3
  documentation HALF_WIRE_C. The F-14 LIA balancing test is explicitly conditional on this.
- **FOLLOW-129** (compliance-engineer, 1.5h, **P0**, before EU pilot go-live): update the tenant
  Privacy Notice template with the §13.1/§13.2 disclosure language, track DPO sign-off (DPIA records
  "DPO review pending"), and add the QA verification that "Deny"/"Withdraw" removes the cross-session
  `localStorage` key (the §13.2 verification action item).
- **FOLLOW-130** (ml-engineer + sdk-engineer, 3h, **P1**, before FOLLOW-100/101): document and test
  the prior-composition order (F-02 cold-start hint → quiz prior → chat-intent prior) and assert the
  F-02 hint seed is idempotent across `init()` re-runs; add a hint-applied debug/telemetry signal so
  the cold-start shift is observable in staging (closes §4a LG-1/LG-2). Cross-reference as a
  precondition in the FOLLOW-100/101 specs.
- **FOLLOW-131** (backend-engineer + sdk-engineer, 2.5h, **P1**): add the missing tests for F-09 +
  F-10 — control-plane `runDecisionTree` locale selection + `?? s.en` total-fallback, `readConfig`
  es-mapping, and `callLlmGateway` → `logLlmCallAsync` attribution threading (assert real ids on the
  authenticated path, `'unknown'` only on the genuinely-anonymous path); pin `runDecisionTree`
  positional-arg order as a regression guard (closes §4c TG-1/TG-2, §4b CB-1/CB-2).

### 8. Cross-references

- **RETRO-016 (FOLLOW-117, PR #156)** — nearest sibling: both touch `api/adapt/route.ts`. This PR's
  F-10 `tenantId`-resolution move (earlier in GET) coexists cleanly with FOLLOW-117's pilot_frozen
  guard; verified no conflict (§5a). Both are PILOT-001 launch-readiness wires.
- **RETRO-017 (FOLLOW-114, PR #157)** — same merge wave; RETRO-017 surfaced a code-side HALF_WIRE_C
  (detection→schema). This retro surfaces a NEW shape: a *documentation*-side HALF_WIRE (DPIA→banner
  copy). Both are "the thing a consumer expects is not produced," at different layers (Rule L spirit,
  not re-promoted).
- **RETRO-013/014/015** — Wave-3 dashboard/route fixes; no overlap beyond the shared adapt-route
  file neighborhood (different concerns: cta-lift/inquiry-starts vocabulary + fail-loud, vs.
  locale/attribution here).
- **First YELLOW-track retro** — RETRO-018 is the first retrospective for the parallel YELLOW audit
  track (F-NN numbering, non-agent-prefix branch); prior retros are all FOLLOW-NNN / TICKET-NNN
  sprint work.

---

## RETRO-019 — FOLLOW-129 (Tenant Privacy Notice template + DPO sign-off + consent-withdrawal erasure QA) — 2026-05-27

### 1. Summary of change

- **PR:** #159 (merged 2026-05-27 19:50 UTC / 21:50 +0200, commit `10ae1e7`). FIRST of the four
  Sprint 13a-hardening (pre-pilot gate) retros. compliance-engineer; `depends_on: FOLLOW-128` (PR
  #160, the SDK banner copy, merged ahead of this in the same wave). Implements RETRO-018 §4d DG-2.
- **Files changed:** 4 (+222 / −13). **Docs-only — zero code.** `docs/compliance/dpia.md`
  (§13.1/§13.2 cross-refs + GREEN balancing test + DPO gates), new
  `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` (+127, tenant-embed template), `docs/compliance/README.md`
  (index entry), `docs/ops/PILOT_RUNBOOK.md` (+35, EU pre-flight compliance checklist).
- **Modules touched:** docs (compliance) + docs (ops). No SDK / control-plane / ingest / decision-api
  / data / db-migration / config / test code touched.
- **Key contracts changed:**
  - **N/A — no code contract.** No exported type, route, schema field, or DB migration. The change is
    entirely prose: tenant-facing disclosure templates, a DPO-gate tracking table, an EU pre-flight
    runbook checklist, and the DPIA §13.2 balancing-test status transition (`conditional` → `GREEN —
    contingent on FOLLOW-128 deployment`). All of these create **process/compliance obligations**,
    not API surface. (The second commit was a prettier-stability fix: bracketed `> **[Tenant: ...]**`
    blockquote callouts triggered a `proseWrap:always` non-idempotency loop in prettier, replaced
    with a bold em-dash `Tenant action —` form — a CI-format workaround, recorded for the convention
    note in §6.)

### 2. Verification done in PR

- Test files changed: **NONE** (docs-only PR; nothing automatable in a `*.test.ts` sense).
- Assertions added: **0** automated. The PR's substance is itself a set of **manual** verification
  gates (8-item EU pre-flight checklist + 6-row DPO gate table), all marked **PENDING**.
- Coverage delta: **N/A** (no executable code).
- CI checks: merged with the real merge gates green per QUEUE.md (`10ae1e7`, FOLLOW-129 DONE). The
  one CI struggle was the prettier blockquote non-idempotency (fixed in commit 2); standing CI-gate
  caveat applies (Rule I / Vercel / Python lanes pre-existing-red & non-blocking).
- **Rule L verdict:** this PR is the *documentation* of a compliance control. The thing the doc now
  "consumes"/asserts (a 90-day cross-session localStorage identifier that is deleted on
  Deny/Withdraw) is a **producer that does not exist in the SDK** — see §3. So the PR passes its own
  CI but FAILS the Rule-L-spirit check at the doc→code boundary: the artifact it describes is not
  produced by any shipped code.

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- No new file or exported symbol added in production code (docs-only). The new
  `PRIVACY_NOTICE_TEMPLATE.md` is referenced from `docs/compliance/README.md`, `dpia.md` §13.1/§13.2,
  and `PILOT_RUNBOOK.md` (4 inbound doc references — not orphaned). **CHECK A clean** (no code
  surface to assess).

**CHECK B — Half-wire detection (the central finding of this retro):**

- **HALF_WIRE_C — documentation/compliance kind: the DPIA §13.2 + Privacy Notice §3 + PILOT_RUNBOOK
  EU pre-flight gate all assert a "90-day cross-session pseudonymous identifier stored in
  `localStorage`, immediately deleted if you withdraw consent or click Decline" — but NO such key
  exists and NO erasure code runs on Deny/Withdraw.** Priority **P0** → **FOLLOW-139**. Evidence:
  - **Producer side (the 90-day localStorage id):** searched
    `localStorage`/`fingerprint`/`cross-session`/`estalara_` across `packages/sdk/src` (non-test).
    The only localStorage keys are `estalara_consent` (`core/session.ts:16`, the consent flag) and
    `__estalara_quiz_dismissed__` (`ui/quiz-trigger.ts:30`, a 24h dismissal flag). The session
    **fingerprint** (`__estalara_session__`, `core/session.ts:53`) is in **`sessionStorage`** — which
    is **tab-lifetime, cleared on tab close, NOT 90-day, NOT localStorage.** There is **no 90-day
    localStorage identifier producer anywhere in the SDK.** The disclosed artifact does not exist.
  - **Erasure side (deletion on Deny/Withdraw):** the `onDenied` handler (`index.ts:118`) calls only
    `setConsentState('denied')`, which **`setItem`s** `estalara_consent='denied'`
    (`core/session.ts:38-40`) — it **never `removeItem`s** anything. `grep removeItem packages/sdk/src`
    → zero hits. So even the existing `__estalara_session__`/`estalara_consent` keys are NOT erased on
    deny; the SDK simply halts and destroys the shadow host (`index.ts:93`). The documented promise
    *"immediately deleted if you withdraw consent"* has **no implementing code.**
  - Classification: a compliance control (DPIA §13.2 lawful-basis disclosure + the FOLLOW-129 AC3 QA
    gate + the runbook pre-flight item) whose runtime counterpart is unimplemented — **HALF_WIRE_C**,
    P0, because (a) the DPIA conditions the §13.2 lawful basis on the disclosure being *accurate*, and
    a disclosure that promises a 90-day-localStorage-deleted-on-withdraw behavior the code never
    performs is a **false statement to data subjects** (worse than the missing-string gap RETRO-018
    flagged — this is a *wrong*, not merely *absent*, disclosure), and (b) the FOLLOW-129 AC3 staging
    QA gate ("Deny/Withdraw removes the cross-session localStorage key") is **unexecutable as written**
    — there is no such key to observe removed, so the gate would either falsely pass (key absent
    because it never existed) or block forever. → **FOLLOW-139** (reconcile: either implement the
    90-day id + withdrawal erasure, OR correct DPIA §13.2/Privacy Notice §3/runbook to the actual
    sessionStorage tab-lifetime reality).
- No new env var, DB column, Redpanda topic, or SDK event introduced (docs-only).

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P1) — the DPIA §13.2 balancing test was flipped to "GREEN — contingent on FOLLOW-128
  deployment," but GREEN is contingent on a SECOND, untracked condition that FOLLOW-128 did NOT
  satisfy: that the disclosed behavior is TRUE.** FOLLOW-128 (PR #160) added the *banner string*
  (verified live: `consent-banner.ts:145-146` renders the "...stored ...for up to 90 days... deleted
  if you withdraw consent" disclosure). So the string now exists — closing RETRO-018's HALF_WIRE.
  But shipping the *sentence* without the *behavior* (§3) means the GREEN marking now rests on a
  disclosure that is **factually inaccurate**. The DPIA's own logic ("balancing test passed only if
  the cross-session nature is disclosed") implicitly assumes the disclosure is accurate; it does not
  guard against a disclosure that over-promises. The GREEN status should not be treated as
  unconditionally passed until §3/FOLLOW-139 is resolved. → folded into FOLLOW-139 AC2 (re-evaluate
  the §13.2 balancing test after reconciliation).

#### 4b. Code bugs not caught

- **CB-1 (P0, latent compliance defect, surfaced by this doc PR) — the SDK consent-withdrawal path
  does not erase any stored identifier.** Detailed in §3. This is not introduced by THIS PR (the PR
  added no code), but the PR's QA gate is what *should* have caught it; instead the gate was written
  as PENDING and the gap shipped undetected into the runbook as a checkbox rather than a fixed bug.
  The pilot dashboard / consent flow currently retains `estalara_consent` and (until tab close)
  `__estalara_session__` after a deny. → FOLLOW-139.
- **CB-2 (P3, doc nit) — Privacy Notice §3 says the identifier "rotates automatically every 30 days"
  while the SDK banner string (FOLLOW-128) and DPIA say "rotates monthly."** Monthly ≈ 30 days so not
  contradictory, but with no rotation code at all (no producer), the cadence claim is moot; fold the
  wording reconciliation into FOLLOW-139 AC1.

#### 4c. Test coverage gaps

- **TG-1 (P0) — there is no automated test, and per the runbook explicitly cannot be a CI test, that
  asserts consent-withdrawal erases stored keys.** A SDK unit test CAN, however, assert that
  `onDenied` calls `removeItem` (once the behavior exists) — the runbook's "cannot be automated from
  CI" claim is true only for the full-browser staging round-trip, not for the unit-level erasure
  assertion. The absence of even a unit test is what let the missing-erasure bug (§3/CB-1) go
  unnoticed. → FOLLOW-139 AC2 (unit test: key absent after deny/withdraw).

#### 4d. Documentation gaps

- **DG-1 (P0) — the DPIA §13.2, Privacy Notice §3, and runbook EU pre-flight gate describe storage
  behavior that diverges from the shipped SDK** (90-day localStorage + withdrawal-deletion vs actual
  sessionStorage tab-lifetime + no deletion). Until reconciled, the canonical compliance docs are
  internally consistent with each other but inconsistent with the code. → FOLLOW-139.
- **DG-2 (P2) — the prettier blockquote workaround (bracketed `> **[...]**` → `> **... —**`) is an
  undocumented CI-format gotcha** that the next agent editing markdown blockquotes under
  `proseWrap:always` will re-hit. See §6 (lesson candidate, not yet rule-promotable).

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13b Lane B, READY) — the §3 HALF_WIRE_C is a NEW EU-go-live blocker
  layered on top of the one RETRO-018 raised.** RETRO-018/FOLLOW-128 closed the *missing-string* gap;
  this retro shows the string that landed is *inaccurate*. PM must treat FOLLOW-139 as a PILOT-001
  EU-go-live precondition alongside FOLLOW-128 (or scope the EU pilot to Mode-A / non-fingerprint and
  strike the 90-day claim). Flagging here per constraint 3 for PM to escalate — this is a
  data-subject-facing accuracy defect, not just a missing control.
- **TICKET-PILOT-002 (go/no-go runbook, BLOCKED) — the EU pre-flight checklist this PR added is the
  right shape, but its "§13.2 staging localStorage QA" item is unexecutable as written** (no key to
  observe). The checklist item must be rewritten (FOLLOW-139 AC3) before the runbook can gate go-live
  honestly — otherwise PILOT-002's gate is a checkbox that cannot be truthfully checked.
- **FOLLOW-128 (PR #160, DONE — sibling in THIS wave) — directly coupled.** FOLLOW-129 is FOLLOW-128's
  documentation counterpart and `depends_on` it. Verified FOLLOW-128's banner now renders both
  disclosure strings (`consent-banner.ts:142-146`); the cross-wave consistency holds at the *string*
  level. The next-wave retros for PRs #160/#161/#162 should note FOLLOW-139 to avoid re-discovering
  the same §13.2 behavior gap independently.

#### 5b. Future sprint tickets affected

- **FOLLOW-092 (TICKET-PILOT-001 shadow-window measurement, BLOCKED) — indirectly:** if FOLLOW-139
  resolves by *correcting docs to sessionStorage reality* (dropping cross-session continuity), the
  "cross-session journey" measurement assumptions PILOT measurement leans on may need revisiting (is
  there cross-session continuity at all, or only tab-lifetime?). Reconcile at FOLLOW-092 spawn.
- **YELLOW Sprint 2–4 stubs FOLLOW-132..138 (reserved, spec-pending) — N/A directly,** but FOLLOW-139
  is, like FOLLOW-128/129, a compliance go-live blocker that arguably belongs on the YELLOW launch-
  readiness track; PM should reconcile whether it lives on the FOLLOW queue or the YELLOW plan to
  avoid double-tracking (same note RETRO-018 §5b raised for FOLLOW-128/129).

#### 5c. Contracts changed that other modules rely on

- **N/A** — no code contract changed. The only cross-module "contract" is the compliance promise to
  data subjects, which §3 shows the SDK does not honor (covered above, not a TS/API surface).

#### 5d. Architectural assumptions affected

- **GDPR / DPIA assumption (continuation of RETRO-018 §5d):** RETRO-018 found the *doc ahead of the
  code* (banner string missing). This retro finds the more dangerous inverse-of-the-fix: the doc and
  the now-shipped banner string both describe a **cross-session storage architecture the SDK never
  implemented.** The Master Design / DPIA assume a 90-day rotating cross-session pseudonymous
  identifier; the actual SDK uses a tab-scoped sessionStorage fingerprint regenerated per tab. This
  is a genuine architecture-vs-disclosure divergence: either the SDK is *missing* the documented
  cross-session feature, or the DPIA over-specifies a feature that was descoped. Master Design
  §(privacy/session model) should be checked for which is canonical. FOLLOW-139 forces the decision.

### 6. New lesson candidates

- **Pattern A — "compliance/documentation control specifies user-facing behavior the code does not
  implement."** RETRO-018 §6 opened this category as "compliance doc prescribes an unimplemented UI
  *string*" (count 1). THIS retro is the **second occurrence of the same parent shape** but a
  distinct sub-form: the doc prescribes an unimplemented *behavior* (90-day storage + deletion-on-
  withdraw), and worse, FOLLOW-128 closed the string gap while leaving the behavior gap open — so the
  shipped string is now *inaccurate*. Parent-pattern count = **2** (RETRO-018 string-absence +
  RETRO-019 behavior-absence/inaccuracy). **This reaches the promotion threshold (≥2).** However, per
  the agent's own discipline I weighed whether these are truly the *same* rule-shape: both are
  "compliance doc asserts X; verify the SDK actually does X before the doc's go-live gate is treated
  as met." They are. → **Promote a rule** (see CONVENTIONS_PATCH.md, Rule below). The rule's
  verification step is grep-able (the disclosure key terms must map to a real SDK symbol).
- **Pattern B — "docs-only PR ships a go-live gate as a PENDING checkbox instead of fixing the
  underlying defect the gate would catch."** The FOLLOW-129 AC3 QA gate *encodes* the §3 bug as a
  pending manual check rather than surfacing it as a P0 bug. Seen here (RETRO-019). Count = 1. Below
  threshold → **NOT promoted.** Process note for PM: a pre-flight gate that cannot currently pass is a
  disguised open bug, not a checklist item.
- **Pattern C — prettier `proseWrap:always` blockquote-bracket non-idempotency.** A CI-format gotcha
  (`> **[label]**` → spurious `>` re-appended each run). Seen: RETRO-019 (commit 2). Count = 1. Not
  rule-shaped at this count; noted in §4d DG-2 for the next markdown editor.

### 7. Follow-ups

- **FOLLOW-139** (sdk-engineer + compliance-engineer, 3h, **P0**, before EU pilot go-live): reconcile
  the DPIA §13.2 / Privacy Notice §3 / runbook "90-day cross-session localStorage identifier deleted
  on Deny/Withdraw" disclosure with the actual SDK storage model — either implement the 90-day id +
  consent-withdrawal `removeItem` erasure (with a unit test asserting the key is absent after
  deny/withdraw), OR correct the three docs to the real sessionStorage tab-lifetime behavior and
  re-evaluate the §13.2 balancing test. Rewrite the FOLLOW-129 §4 DPO-gate row and the PILOT_RUNBOOK
  EU pre-flight "localStorage QA" item to reference the actual key name so the manual gate is
  executable. Closes §3 HALF_WIRE_C, §4b CB-1, §4c TG-1, §4d DG-1. (`depends_on: FOLLOW-128`.)

### 8. Cross-references

- **RETRO-018 (FOLLOW-118/119/120/121, PR #158)** — direct parent: this PR (FOLLOW-129) implements
  RETRO-018 §4d DG-2 and the doc half of RETRO-018's §3 documentation HALF_WIRE_C. RETRO-018 emitted
  FOLLOW-128 (SDK string) + FOLLOW-129 (this doc work). This retro finds the string FOLLOW-128 shipped
  is *inaccurate* — the second occurrence of RETRO-018's Pattern A, which crosses the promotion
  threshold (§6, new CONVENTIONS_PATCH Rule).
- **FOLLOW-128 / PR #160 (`256b469`, same Sprint 13a-hardening wave)** — the SDK banner-copy sibling
  this PR `depends_on`; verified its disclosure strings are live (`consent-banner.ts`). The §13.2
  storage-behavior gap (§3) is the shared blind spot of BOTH tickets — neither closed it.
- **First of four Sprint 13a-hardening (pre-pilot gate) retros** — siblings to follow for PRs #160
  (FOLLOW-128), #161 (FOLLOW-127), #162 (FOLLOW-122). Those retros should reference FOLLOW-139 rather
  than independently re-discovering the §13.2 behavior gap.

---

## RETRO-020 — FOLLOW-128 (Implement DPIA §13.1/§13.2 mandated consent-banner disclosures in the SDK) — 2026-05-27

### 1. Summary of change

- **PR:** #160 (merged 2026-05-27 19:52 UTC / 21:52 +0200, commit `256b469`). SECOND of the four
  Sprint 13a-hardening (pre-pilot gate) retros (RETRO-019 was 1st / PR #159). compliance-engineer +
  sdk-engineer; `depends_on: FOLLOW-118`. Implements RETRO-018 §3's documentation HALF_WIRE_C (the
  DPIA-mandated banner disclosure strings the SDK never rendered). Source retro: RETRO-018 §3/§4d.
- **Files changed:** 2 (+328 / −0). SDK-only. `packages/sdk/src/ui/consent-banner.ts` (+66,
  the two disclosure copy strings × 3 locales + a `<ul class="estalara-consent-disclosures">` render
  block + style), `packages/sdk/src/__tests__/consent-banner.test.ts` (+262, 12 new tests).
- **Modules touched:** SDK only. No control-plane / ingest / decision-api / data / db-migration /
  docs / config touched. (The docs counterpart is FOLLOW-129 / PR #159, retro'd as RETRO-019.)
- **Key contracts changed:**
  - `COPY.{en,pl,es}.disclosure13_1` / `disclosure13_2` — **added** two new per-locale copy keys to
    the internal (non-exported) `COPY` const in `consent-banner.ts` — breaking: **no** (private to the
    module; only consumed by `renderConsentBanner` in the same file).
  - DOM contract: two `<li data-estalara-disclosure="dpia-13-1|dpia-13-2">` elements now render inside
    the consent banner shadow tree before the Accept/Decline buttons — **new** — breaking: **no** (the
    `data-estalara-disclosure` attribute is a NEW automated-verification hook, not a removed one).
  - No exported TS type, API route, event-schema field, or DB migration changed.

### 2. Verification done in PR

- Test files changed: `packages/sdk/src/__tests__/consent-banner.test.ts` (+262).
- Assertions added: **12 new tests** covering all locale × section combinations (§13.1 present in
  en/pl/es; §13.2 present in en/pl/es; correct `data-estalara-disclosure` attribute values;
  disclosures rendered before the consent decision / before the action buttons).
- Coverage delta: **+** for `consent-banner.ts` (both new copy keys and the render branch are now
  exercised); estimate net-positive, no uncovered new lines.
- CI checks: merged with the real merge gates green per QUEUE.md (`256b469`, FOLLOW-128 DONE).
  Standing CI-gate caveat applies (Rule I / Vercel / Python lanes pre-existing-red & non-blocking,
  per the CI-gate-landscape memory).
- **Rule N verdict (the central caveat):** the tests prove the *strings render* and carry the right
  attributes — they do **not** assert the disclosed *behavior* is true. The §13.1 string promises a
  "7-day-then-deleted" audit log and the §13.2 string promises a "90-day localStorage id deleted on
  withdraw." Per Rule N (promoted in RETRO-019), a disclosure test that only checks the sentence
  renders is "if-present-it-shows" evidence, NOT evidence the disclosed behavior exists. Two distinct
  behavior gaps result — see §3.

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- No new file added. The two new internal copy keys (`disclosure13_1`/`disclosure13_2`) are consumed
  by `renderConsentBanner` (`consent-banner.ts:239,243`), which has a real non-test importer/caller
  at `packages/sdk/src/index.ts:23,102` (the SDK init consent-gate path). The new
  `data-estalara-disclosure` DOM attribute is read only by the SDK's own tests today
  (`consent-banner.test.ts` ×14) — it is an automated-verification hook, intended for a future
  external/E2E compliance check; not dead (it is a passive DOM marker, valid even with only test
  readers). **CHECK A clean ✅.**

**CHECK B — Half-wire detection (two findings, split by DPIA section):**

- **§13.1 — HONEST / wired ✅ (dispatch), but a SECONDARY retention claim is unbacked.** The §13.1
  banner string discloses two things: (a) "we record the fact of your consent decision — including a
  denial," and (b) "this log is retained for 7 days and then permanently deleted."
  - **(a) producer EXISTS:** `onDenied` (`index.ts:118-126`) pushes a `consent.denied` audit event,
    and on decline the SDK flushes it via `dispatchEvents` (`index.ts:132-137`) before halting. The
    event type is a valid wire literal (`packages/shared/src/schemas/events/consent.ts:55`,
    `EVENT_TYPES` includes `consent.denied`). So the "we record your denial" half is **genuinely
    wired producer→schema** — a real improvement over the §13.2 case.
  - **(b) the "retained for 7 days then permanently deleted" claim has NO enforcing producer.** Grep
    for `7 day`/`7d`/`retention`/`TTL`/`DELETE`/`expire` against `apps/ingest/src`,
    `packages/shared/src`, and any ClickHouse/SQL schema returns only a 24h idempotency-cache TTL and
    a Redis description-cache TTL — **nothing applies a 7-day deletion to the consent-denied audit
    log.** The audit event is dispatched to ingest with no documented 7-day TTL/retention policy on
    the store. → **HALF_WIRE_C — kind `disclosure-claim:consent-denied-7-day-retention`** — consumer
    side is the data-subject promise (and the eventual DSR/retention auditor); no producer enforces
    the 7-day deletion. Priority **P1** → **FOLLOW-140**. (P1 not P0: unlike §13.2 this disclosure is
    not factually *false at the SDK surface* — the log genuinely is recorded; the gap is an
    *unenforced retention ceiling* downstream, a real but lower-blast-radius compliance defect than a
    consumer NPE.)
- **§13.2 — HALF_WIRE_C, already filed as FOLLOW-139 (RETRO-019). NOT re-filed here.** This PR is the
  ticket that made the §13.2 string LIVE (`consent-banner.ts:145-146,157,169`): "...store a
  pseudonymous identifier in your browser for up to 90 days... rotates monthly... deleted if you
  withdraw consent." RETRO-019 §3 proved no 90-day localStorage id exists (the fingerprint is
  tab-lifetime `sessionStorage`, `core/session.ts:53`) and `onDenied` never `removeItem`s anything
  (`grep removeItem packages/sdk/src` → 0). So **the now-live banner copy FOLLOW-128 shipped is the
  factually-inaccurate data-subject-facing surface** of that gap. Per the task constraint and to
  avoid a duplicate stub, this is tracked by **FOLLOW-139** (P0, `depends_on: FOLLOW-128`) — see §7
  cross-reference; **no new stub created for §13.2.**

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P1) — the §13.2 disclosure string is now LIVE while its disclosed behavior is absent.** The
  string-level HALF_WIRE that RETRO-018 opened is closed by this PR, but closing it without the
  behavior (RETRO-019 §3) converts an *absent* disclosure into an *inaccurate* one. This is the
  realization of RETRO-019 §4a LG-1 ("shipping the sentence without the behavior"). Tracked by
  FOLLOW-139 — not re-filed.

#### 4b. Code bugs not caught

- **CB-1 (P1) — the §13.1 "7-day retention then permanent deletion" promise is unenforced** (§3
  detail). The 12 tests assert the string renders; none assert (and none could, at SDK unit level,
  since enforcement is downstream) that a 7-day TTL exists. The disclosure shipped without a linked
  retention control. → FOLLOW-140.
- **CB-2 (P0, latent, NOT introduced here) — §13.2 storage/withdrawal-erasure absence.** Carried from
  RETRO-019 §4b CB-1; this PR is the surface that disclosed it. → FOLLOW-139 (not re-filed).

#### 4c. Test coverage gaps

- **TG-1 (P1) — there is no test (anywhere in the repo) asserting the consent-denied audit log is
  deleted at the 7-day boundary, nor that a retention policy is configured on its store.** A SDK unit
  test cannot cover this (enforcement is ingest/store-side); the gap belongs to a data/ingest
  retention test. The disclosure currently has zero verification of its truth. → FOLLOW-140 AC.
- **TG-2 (P2) — the new tests assert string presence and attribute values but not the disclosure
  TEXT content (the specific "7 days" / "90 days" / "deleted on withdraw" claims).** A future test
  that pins the claim keywords to real SDK/store symbols (per Rule N verification) would have caught
  both §13.1 and §13.2 behavior gaps at PR time. Worth adding when FOLLOW-139/140 land.

#### 4d. Documentation gaps

- **DG-1 (P2) — N/A as a NEW gap for this SDK-only PR.** The DPIA §13.1/§13.2 doc side is owned by
  RETRO-019/FOLLOW-129/139. Note only: once FOLLOW-140 decides the §13.1 retention reality, the DPIA
  §13.1 "7-day" figure must be reconciled byte-for-byte with whatever TTL ships (or the claim
  softened). Folded into FOLLOW-140 AC, not a separate doc stub.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13b Lane B, READY) — partially de-risked, two residual blockers.** This
  PR closes the *missing-disclosure-string* blocker RETRO-018 raised (the EU banner now renders both
  DPIA disclosures). But the EU go-live story is NOT clean: §13.2 is inaccurate (FOLLOW-139, P0) and
  §13.1's 7-day claim is unenforced (FOLLOW-140, P1). PM should treat FOLLOW-139 as a hard EU-go-live
  precondition and FOLLOW-140 as a should-fix-before-EU-go-live (or soften the §13.1 retention claim).
  Flagged here per constraint 3 for PM escalation — both are data-subject-facing accuracy/retention
  defects, not just missing controls.
- **TICKET-PILOT-002 (go/no-go runbook, BLOCKED) — the EU pre-flight checklist (added by FOLLOW-129)
  now has a TWO-claim verification surface, not one.** The runbook's §13.2 localStorage-QA item is
  unexecutable (FOLLOW-139); separately, a §13.1 "verify 7-day audit-log deletion" pre-flight item
  does not yet exist and should — FOLLOW-140 should add/own it so the runbook can gate honestly on
  both disclosures.
- **FOLLOW-129 (PR #159, DONE — sibling, RETRO-019) — directly coupled (the doc↔SDK pair).** This PR
  is FOLLOW-129's `depends_on` SDK counterpart; verified the strings FOLLOW-129's docs reference are
  live (`consent-banner.ts:142-169`). String-level cross-wave consistency holds. The shared blind
  spot of BOTH tickets is the §13.2 *behavior* (FOLLOW-139) and, newly surfaced here, the §13.1
  *retention* (FOLLOW-140).

#### 5b. Future sprint tickets affected

- **FOLLOW-092 (TICKET-PILOT-001 shadow-window measurement, BLOCKED) — indirectly:** unchanged from
  RETRO-019 §5b — if §13.2 resolves toward sessionStorage-tab-lifetime reality (FOLLOW-139), the
  cross-session measurement assumptions need revisiting. This PR does not alter that.
- **YELLOW Sprint 2–4 stubs (FOLLOW-132..138, reserved) — N/A directly,** but FOLLOW-140, like
  FOLLOW-128/129/139, is a compliance go-live item; same double-tracking caution RETRO-018 §5b /
  RETRO-019 §5b raised — PM should decide whether it lives on the FOLLOW queue or the YELLOW plan.

#### 5c. Contracts changed that other modules rely on

- **N/A for TS/API surface** — the only changed contract is the internal `COPY` const + a passive DOM
  marker attribute, neither cross-module. The cross-module "contract" is again the compliance promise
  to data subjects (§13.1 retention + §13.2 storage), which §3 shows is partly unbacked (covered by
  FOLLOW-139/140).

#### 5d. Architectural assumptions affected

- **GDPR/DPIA assumption (continuation of RETRO-018 §5d and RETRO-019 §5d):** RETRO-018 = doc ahead of
  the code (string missing); RETRO-019 = doc + SDK both describe a storage architecture the SDK never
  built. THIS retro adds a third, narrower instance on the §13.1 axis: the SDK now honestly *produces*
  the consent-denied audit event, but the disclosed *retention ceiling* (7-day deletion) has no
  enforcing component — the architecture assumes a retention/TTL policy on the audit store that is
  not yet specified or implemented. Master Design / DPIA §13.1 should confirm where consent-audit
  retention is enforced (ingest? ClickHouse TTL? a retention cron?). FOLLOW-140 forces that decision.

### 6. New lesson candidates

- **Pattern N (doc/disclosure asserts behavior the code does not implement) — THIRD occurrence.**
  RETRO-018 (string absence) + RETRO-019 (behavior absence/inaccuracy, §13.2) → **Rule N was already
  promoted in CONVENTIONS_PATCH.md by RETRO-019.** This retro is a third confirming instance on a new
  axis (§13.1 unenforced retention claim), which is exactly what Rule N's verification grep
  (`grep ... removeItem / retention / TTL ...`) is designed to catch. **Do NOT re-promote** — Rule N
  already covers it. Logged here as additional evidence strengthening Rule N. (Per the agent's
  no-double-promotion discipline.)
- **Pattern B (docs/feature ships a go-live gate as a PENDING checkbox instead of fixing the
  underlying defect) — SECOND occurrence.** RETRO-019 §6 opened this (count 1) for the FOLLOW-129 AC3
  QA gate. This PR's 12 tests are the SDK analogue: they encode "the disclosure renders" as a green
  gate while the disclosed behavior (§13.1 retention, §13.2 storage) stays unverified — a passing test
  suite that masks an unbacked claim. Count = **2**. *Considered for promotion.* On reflection I judge
  it is a **specialization of Rule N**, not a distinct rule-shape: both reduce to "a green
  test/checkbox proves presentation, not the disclosed behavior — verify the behavior before treating
  the gate as met," which Rule N's verification section already mandates. **NOT separately promoted**
  to avoid noise/overlap; noted so a future, clearly-distinct third occurrence can revisit.
- **Pattern: §13.1 producer-honest / retention-unenforced split** — a disclosure can be *partly*
  wired (the recording happens) yet still over-promise on a *secondary* clause (the deletion). Count
  = 1. Below threshold, not rule-shaped; noted for future retros to watch the "secondary clause"
  failure mode within an otherwise-wired disclosure.

### 7. Follow-ups

- **FOLLOW-140** (data-engineer + compliance-engineer, 2h, **P1**, before/at EU pilot go-live):
  enforce or correct the §13.1 consent-banner promise that the consent-decision audit log "is
  retained for 7 days and then permanently deleted." Today the `consent.denied`/`consent.granted`
  audit events are dispatched to ingest with NO 7-day retention/TTL enforcement on the store (only a
  24h idempotency cache + a Redis description cache exist). Either (a) configure a 7-day
  TTL/retention policy on the consent-audit store (ClickHouse TTL / retention cron) with a test
  asserting the policy, OR (b) correct the §13.1 banner string + DPIA §13.1 to the actual retention
  period. Add the corresponding §13.1 "verify 7-day audit-log deletion" item to the PILOT_RUNBOOK EU
  pre-flight checklist so it is executable. Closes §3 §13.1 HALF_WIRE_C, §4b CB-1, §4c TG-1.
  (`source_retro: RETRO-020`.)
- §13.2 banner-copy-vs-behavior inaccuracy: **covered by FOLLOW-139 (RETRO-019) — no new stub.**

### 8. Cross-references

- **RETRO-019 (FOLLOW-129, PR #159, `10ae1e7`, same Sprint 13a-hardening wave)** — the docs
  counterpart this PR is the SDK `depends_on` for. RETRO-019 §3 found the §13.2 90-day-localStorage /
  delete-on-withdraw behavior is absent; THIS retro confirms FOLLOW-128 is the PR that made that
  inaccurate string LIVE, and routes it to RETRO-019's **FOLLOW-139** rather than duplicating. Rule N
  (CONVENTIONS_PATCH.md) was promoted by RETRO-019 off this exact pattern; RETRO-020 is a third
  confirming instance (§13.1 axis), not a re-promotion.
- **RETRO-018 (FOLLOW-118/119/120/121, PR #158)** — root cause: RETRO-018 §3 documentation HALF_WIRE_C
  ("DPIA mandates a banner string the SDK never renders") emitted FOLLOW-128 (this ticket, the SDK
  string) + FOLLOW-129 (the doc). FOLLOW-128 closes RETRO-018's *string-absence* gap — but, as
  RETRO-019 + this retro show, exposes the deeper *behavior-absence* gaps beneath it.
- **SECOND of four Sprint 13a-hardening (pre-pilot gate) retros** — siblings: RETRO-019 (#159 / done),
  and still-to-come retros for #161 (FOLLOW-127) and #162 (FOLLOW-122). Those should reference
  FOLLOW-139 (§13.2) and FOLLOW-140 (§13.1) rather than independently re-discovering the disclosure
  behavior gaps.

---

## RETRO-021 — FOLLOW-127 (Detection engine must PRODUCE inquiry_submit_selector — close the detection→schema producer) — 2026-05-27

### 1. Summary of change

- **PR:** #161 (merged 2026-05-27 19:53 UTC / 21:53 +0200, commit `6a27841`). THIRD of the four
  Sprint 13a-hardening (pre-pilot gate) retros (RETRO-019 = PR #159 / 1st; RETRO-020 = PR #160 / 2nd;
  next = 4th, PR #162 / FOLLOW-122). ml-engineer + backend-engineer; `depends_on: FOLLOW-114`.
  Source retro: RETRO-017 §3 HALF_WIRE_C / §4a LG-1 — the transitive Rule L producer gap where the
  schema→SDK-config→snippet **consumer** chain (closed by FOLLOW-097 / PR #151 and FOLLOW-114 /
  PR #157) had **no production code populating the field on a real detected schema**; it lived only
  in the hand-authored `000-app-estalara` fixture.
- **Files changed:** 6 (+678 / −15). New deterministic probe + pipeline wiring + AI-Vision parser +
  a test-only typecheck helper.
  - `packages/sdk/src/auto-detect/detect-inquiry-selector.ts` (new, +240) — `detectInquirySubmitSelector(html)`
    L1–L7 DOM heuristic ladder; returns `string | null`, never `""`.
  - `packages/sdk/src/auto-detect/pipeline.ts` (+7) — post-processing call inside `detectSiteSchema`;
    sets `finalSchema.inquiry_submit_selector` only when the probe returns non-null.
  - `packages/sdk/src/auto-detect/techniques/ai-vision.ts` (+17) — Technique 11 prompt + parser also
    extract the selector (TG-1 guard: trim + non-empty).
  - `packages/sdk/src/auto-detect/index.ts` (+1) — barrel re-export of `detectInquirySubmitSelector`.
  - `packages/sdk/src/auto-detect/__tests__/detect-inquiry-selector.test.ts` (new, +345) — 20 unit
    tests (L1–L7 ladder + pipeline integration).
  - `apps/control-plane/src/app/api/detect/route.test.ts` (+83 / −15) — 3 new FOLLOW-127 tests +
    `withDbMock()` typecheck helper refactor.
- **Modules touched:** SDK (auto-detect) + control-plane (test only). No ingest / decision-api / data
  / db-migration / docs / config touched.
- **Key contracts changed:**
  - `detectInquirySubmitSelector(html: string): string | null` — **new** exported SDK symbol
    (`auto-detect` barrel) — breaking: **no** (additive).
  - `DetectionResult.schema.inquiry_submit_selector` — now **populated by production code** (was
    fixture-only). The `TenantSiteSchema.inquiry_submit_selector?: string | null` field
    (`packages/shared/src/tenant-site-schema.ts:249`) is unchanged — breaking: **no**.
  - AI-Vision `AiVisionResponse.inquiry_submit_selector?: unknown` — **new** optional parsed field —
    breaking: **no**.
  - No API route signature, event-schema, or DB migration changed (the field rides the existing
    `schema` JSONB blob).

### 2. Verification done in PR

- Test files changed: `detect-inquiry-selector.test.ts` (new, +345), `route.test.ts` (+83/−15).
- Assertions added: **20** unit tests for the L1–L7 probe (incl. 3 pipeline-integration tests at
  `detect-inquiry-selector.test.ts:244-343`: field present when an inquiry form exists, ABSENT when
  none, and `tenant_id` + selector both set together) + **3** control-plane round-trip/TG-1 tests
  (`route.test.ts:778-815`: wizard response preserves a pipeline-populated selector; never emits `""`).
- Coverage delta: **+** for the new SDK file (L1–L7 branches exercised) and the AI-Vision parser
  branch; net-positive, no obviously-uncovered new lines.
- CI checks: merged with the real merge gates green per QUEUE.md (`6a27841`, FOLLOW-127 DONE).
  Standing CI-gate caveat applies (Rule I / Vercel / Python lanes pre-existing-red & non-blocking,
  per the CI-gate-landscape memory).
- **AC verdict (the central caveat — see §4a).** AC1–AC3 (a *real-tenant* detection produces the
  field end-to-end) are supported only by **synthetic** unit fixtures (hand-built HTML strings inside
  the test file). AC4 (the pilot hand-set interim value) is **asserted by the ticket but NOT present
  in any committed seed/migration** — see §3 CHECK B and §4a LG-1. The producer code is genuinely
  wired; the *evidence that it works on the pilot's real site* and that *the pilot row actually
  carries the interim value* is absent.

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- `detectInquirySubmitSelector` (new file `detect-inquiry-selector.ts`) — re-exported via the
  `auto-detect/index.ts` barrel AND imported by a **real runtime consumer**:
  `pipeline.ts:39` imports it and calls it at `pipeline.ts:121` inside `detectSiteSchema` (the
  server-side `/api/detect` detection path). Non-test importers ≥ 1. **Not dead.**
- The barrel re-export (`auto-detect/index.ts:12`) traces one hop further to the SDK public surface;
  even setting it aside, the `pipeline.ts` caller is a genuine consumer. **CHECK A clean ✅.**

**CHECK B — Half-wire detection (DB column / schema field `inquiry_submit_selector`):**

- **Producer (NEW this PR) — EXISTS ✅.** `pipeline.ts:121-123` sets
  `finalSchema.inquiry_submit_selector` from the probe; `ai-vision.ts:250` sets it from the LLM.
- **Persist hop — EXISTS ✅ (transitive).** `/api/detect` returns `result.schema`
  (`route.ts:417,438`) carrying the field; `/api/schema/activate` upserts the whole `schemaValue`
  JSONB blob (`activate/route.ts:166,173`) into `tenant_site_schemas.schema`, so a detected value is
  persisted without a dedicated column mapping.
- **Consumer — EXISTS ✅ (closed by FOLLOW-097/114, pre-existing).** `DetectionPreview.tsx:173`
  threads it into the snippet; `packages/sdk/src/index.ts:381` → `core/config.ts` → `core/observer.ts`
  surface it to the Observer at runtime. So the full producer→persist→consumer wire is now CLOSED for
  any **real detection that finds a selector**. — **No HALF_WIRE for the general path.**
- **HALF_WIRE_C (NEW) — the PILOT path. `schema-field:inquiry_submit_selector` on the pilot tenant
  row.** AC4 states an interim value `"[data-estalara-slot='inquiry-submit']"` was hand-set on the
  pilot schema to unblock TICKET-PILOT-001. **No committed artifact sets it:** a search of
  `packages/db/migrations/**` (incl. `0015_pilot_frozen.sql`, which only adds a `pilot_frozen`
  boolean and contains no `inquiry`), `0003_tenant_site_schemas.sql`, seed scripts, and
  `apps/control-plane/src/lib/**` finds the string ONLY in the test ground-truth fixture
  `packages/sdk/src/auto-detect/__fixtures__/000-app-estalara/detail-ground-truth.json:19` — a
  fixture, not the pilot tenant row. The Observer consumer (`index.ts:381`) expects this value to
  arrive from the activated tenant schema; if the pilot row was never seeded/activated with it, the
  consumer reads `undefined` at pilot runtime and the inquiry-tracking wire is silently inert. →
  **HALF_WIRE_C — priority P0** → **FOLLOW-141**. (P0 per Step 6: a consumer expecting data that
  never arrives is silently broken at runtime — exactly the inquiry-conversion measurement
  TICKET-PILOT-001 depends on.)

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P0) — AC4's "interim hand-set value on the pilot schema" has no committed home.** The
  ticket treats PILOT-001 as unblocked because the pilot schema carries
  `"[data-estalara-slot='inquiry-submit']"`. But that value lives only in a *test fixture*, not in a
  migration, seed, or activation call against the pilot tenant. Either the value was set out-of-band
  (manual DB edit — unverifiable, not reproducible, lost on any re-seed) or it was never set at all.
  Impact: the pilot's inquiry-conversion signal is the headline pilot metric; if the row is missing
  the selector, the Observer never wires the inquiry listener and the pilot measures nothing. →
  FOLLOW-141.
- **LG-2 (P2) — the deterministic probe and the AI-Vision parser can DISAGREE, and the pipeline
  silently prefers the probe.** For Technique 11 (AI Vision), `detectAiVision` sets the field from the
  LLM (`ai-vision.ts:250`), but `detectSiteSchema` then *overwrites* it with the deterministic probe
  result whenever the probe returns non-null (`pipeline.ts:121-123` runs unconditionally on the
  post-processed `finalSchema`). For AI-Vision detections this means the LLM's selector is discarded
  in favor of the probe — likely the intended precedence, but it is undocumented and untested (no
  test asserts which wins on conflict). Low blast radius; noted for the next auto-detect editor. →
  folded into FOLLOW-141 AC (document/test precedence) — not a separate stub.

#### 4b. Code bugs not caught

- **CB-1 (P2) — `elementText` assumes `el.textContent` is non-null.** `detect-inquiry-selector.ts`
  `elementText` calls `el.textContent.replace(...)`; `Element.textContent` is typed `string | null`
  in the DOM lib. In jsdom it is `""` for empty elements so tests pass, but a strict null check / a
  runtime where `textContent` is null on an exotic node would throw inside the L4/L6 cascade. Defensive
  `?? ''` is warranted. Low severity (real browsers/jsdom return `""`). → noted; folded into
  FOLLOW-141 AC only if the file is reopened.

#### 4c. Test coverage gaps

- **TG-1 (P1) — no real-site / corpus accuracy measurement for `inquiry_submit_selector`.** All 23
  added tests use hand-built synthetic HTML. The auto-detect corpus harness
  (`test-utils.ts:550-568`) scores `detail` ground-truth fields by iterating `Object.entries(expected)`,
  and the `000-app-estalara` detail ground-truth DOES list `inquiry_submit_selector`
  (`detail-ground-truth.json:19`) — BUT the harness reads the *detected* value from the per-field
  `detail_schema` slot map (`detected[fieldKey]`), NOT from the top-level
  `finalSchema.inquiry_submit_selector` the pipeline now populates. So the new field is **not actually
  scored** by the corpus precision/recall harness, and there is exactly **one** fixture site. AC1–AC3
  (real-tenant end-to-end production) is therefore unmeasured against the corpus — the probe's L2–L7
  heuristics could be wrong on real sites and CI would stay green. → FOLLOW-141 AC.
- **TG-2 (P2) — no test asserts probe-vs-AI-Vision precedence** (the LG-2 conflict). → folded into
  FOLLOW-141.

#### 4d. Documentation gaps

- **DG-1 (P2) — the L1–L7 heuristic ladder and the field's stated stability/confidence ranking are
  documented only in the source file's docblock**, not in MASTER_DESIGN §B (auto-detection) or a
  detection ADR. Future detection-tuning tickets (and the ml-engineer who owns platform-templates)
  will not discover the ladder's precedence rules from the design docs. → folded into FOLLOW-141 AC
  (record the ladder + probe/LLM precedence in the canonical detection section), not a separate stub.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13b Lane B, READY) — the §3 HALF_WIRE_C / §4a LG-1 is a direct pilot
  blocker, NOT the clean unblock AC4 claims.** FOLLOW-127's *general* detection path is now wired
  (good), but the pilot's reliance on a hand-set interim value is unverified: no committed seed sets
  `inquiry_submit_selector` on the pilot tenant row. If the pilot tenant uses the real detection
  pipeline, the L1 rule (`[data-estalara-slot='inquiry-submit']`) only fires if the pilot site
  actually carries that Tier-3 marker in its DOM — otherwise L2–L7 must succeed, and that is
  unmeasured (§4c TG-1). PM must confirm BEFORE pilot go-live that the pilot tenant's activated
  schema carries a valid `inquiry_submit_selector` (re-detect-and-activate, or commit a seed). Flagged
  here per constraint 3 for PM escalation — this is the headline pilot conversion metric's wire.
- **TICKET-PILOT-004 (`backlog/sprint-12/TICKET-PILOT-004.md`, references `inquiry_submit_selector`)
  — verify its assumptions still hold.** It is the other ticket in the repo that names the field;
  whatever it asserts about the selector being present should be reconciled against §3 (the value may
  not be seeded). PM to confirm at PILOT-004 pickup.
- **FOLLOW-114 (PR #157, DONE — the consumer-chain ticket this `depends_on`) — now fully satisfied on
  the general path.** RETRO-017 §3 raised the HALF_WIRE_C (consumer with no producer); FOLLOW-127 is
  the producer it asked for. Verified the FOLLOW-114 consumer hops are live
  (`DetectionPreview.tsx:173`, `index.ts:381`). The lineage's *remaining* hole is the pilot-row
  population (FOLLOW-141), a narrower instance of the same producer gap.

#### 5b. Future sprint tickets affected

- **FOLLOW-092 (TICKET-PILOT-001 shadow-window measurement, BLOCKED) — directly downstream:** the
  inquiry-submit event is presumably one of the conversion signals the shadow-window measures. If the
  selector is not wired on the pilot row (§3), FOLLOW-092 measures zero inquiries regardless of true
  conversion. Reconcile FOLLOW-141 before FOLLOW-092 spawns.
- **YELLOW Sprint 2–4 stubs FOLLOW-132..138 (reserved, spec-pending) — N/A directly.** FOLLOW-141 is
  a pilot-readiness wiring fix, not a YELLOW launch-readiness item; it belongs on the FOLLOW queue.
- **Platform-templates expansion (ml-engineer, future) — affected:** once more real platforms are
  added to the auto-detect corpus, the L2–L7 inquiry heuristics need per-platform ground-truth +
  harness scoring (§4c TG-1). The corpus harness should be extended to score the top-level field then.

#### 5c. Contracts changed that other modules rely on

- **N/A for breaking changes** — all changes are additive. The cross-module contract is the
  `schema` JSONB shape: the Observer consumer (`packages/sdk/src/index.ts:381`) now genuinely receives
  a producer-populated `inquiry_submit_selector` on real detections (improvement). The only residual
  contract risk is the pilot row not carrying the field (§3, behavioral not type-level).

#### 5d. Architectural assumptions affected

- **Rule L / producer-consumer-wire assumption (continuation of the RETRO-009/010/011/017 lineage):**
  RETRO-017 §3 assumed "close the producer and the detection→schema→SDK wire is whole." FOLLOW-127
  closes it for the **general detection path** — but reveals a second-order assumption: that the
  *pilot* (a frozen, possibly-hand-seeded tenant) goes through the same detection→activate path. The
  pilot is a special case where a value was asserted hand-set but is not reproducibly committed. The
  architectural lesson: a producer that works in the general pipeline does NOT guarantee a
  pre-existing/frozen row carries the value — frozen-tenant seeds must be re-validated whenever a new
  schema field becomes load-bearing. Master Design §B (auto-detection) should note the L1–L7 ladder
  (§4d DG-1).

### 6. New lesson candidates

- **Pattern (Rule L lineage) — "a new producer closes the general wire but a frozen/pre-seeded row is
  left carrying the field out-of-band (or not at all)."** The parent Rule-L / HALF_WIRE_C pattern
  (producer-consumer wiring) is heavily represented — RETRO-009/010/011/017 — and **Rule L is already
  promoted in CONVENTIONS_PATCH.md.** This retro is a *confirming* instance on a NEW sub-axis (the
  frozen-pilot-row population gap), exactly the failure Rule L's verification is meant to catch. Per
  the no-double-promotion discipline and the task's explicit instruction (do NOT re-promote an
  existing rule on a single new occurrence), **Rule L is NOT re-promoted.** Logged here as evidence
  strengthening Rule L.
- **Pattern (new sub-shape) — "AC asserts a value was hand-set/seeded but the value lives only in a
  test fixture, not in a committed migration/seed."** This is a distinct shape from Rule L (it is
  about *provenance of a claimed manual fix*, not producer-consumer wiring). Seen: RETRO-021 (this
  retro). Count = **1**. Below the promotion threshold (2). NOT promoted; recorded so a future second
  occurrence (e.g. another "interim hand-set on the pilot" claim) crosses the threshold.
- **Pattern — "new schema field is populated by production code but never scored by the detection
  corpus accuracy harness."** Seen: RETRO-021 (§4c TG-1). Count = 1. Below threshold. Noted for the
  next auto-detect field addition.

### 7. Follow-ups

- **FOLLOW-141** (backend-engineer + ml-engineer, 3h, **P0**, before EU/pilot go-live): make the
  pilot tenant's `inquiry_submit_selector` real and verified, and measure the producer's accuracy.
  Closes §3 HALF_WIRE_C, §4a LG-1, §4c TG-1, and folds in §4a LG-2 / §4d DG-1.
  (`source_retro: RETRO-021`, `depends_on: FOLLOW-127`.)

### 8. Cross-references

- **RETRO-017 (FOLLOW-114, PR #157)** — root cause: RETRO-017 §3 HALF_WIRE_C / §4a LG-1 identified
  the consumer-with-no-producer gap and `inquiry_submit_selector` was the canonical example.
  FOLLOW-127 (this PR) is the producer RETRO-017 demanded; the general wire is now closed, with the
  pilot-row population (FOLLOW-141) the residual hole.
- **RETRO-011 (FOLLOW-097, PR #151) and FOLLOW-114 (PR #157)** — the consumer chain
  (schema→SdkConfig→snippet→Observer) closed before this PR; verified live
  (`DetectionPreview.tsx:173`, `index.ts:381`). FOLLOW-127 connects the missing producer end.
- **Rule L (CONVENTIONS_PATCH.md)** — promoted off the RETRO-009/010/011/017 producer-consumer-wire
  lineage. RETRO-021 is a confirming instance (frozen-pilot-row sub-axis), NOT a re-promotion.
- **THIRD of four Sprint 13a-hardening (pre-pilot gate) retros** — siblings: RETRO-019 (#159 /
  FOLLOW-139), RETRO-020 (#160 / FOLLOW-140), and the still-to-come 4th retro for #162 (FOLLOW-122).
  The 4th retro should note FOLLOW-141 if it touches the pilot tenant row or the inquiry wire.

---

## RETRO-022 — FOLLOW-122 (Wire /dashboard/pilot to consume data_source provenance + surface the fail-loud HTTP 500 state — cta-lift + inquiry-starts) — 2026-05-27

### 1. Summary of change

- **PR:** #162 (merged 2026-05-27 ~21:53 UTC+2, commit `29c97ab`). FOLLOW-122 (backend-engineer).
  **FOURTH and final of the four Sprint 13a-hardening (pre-pilot gate) retros** (siblings: RETRO-019
  #159 / FOLLOW-139, RETRO-020 #160 / FOLLOW-140, RETRO-021 #161 / FOLLOW-141). Source retro RETRO-013
  (which raised the cta-lift consumer-swallow); this PR also closes RETRO-008 TG-2 (the
  `/dashboard/pilot` provenance-read half of the go/no-go data-provenance check).
- **Files changed:** 4 (+additions / −deletions per the commit; new
  `inquiry-starts/route-helpers.ts` +43, `page.tsx` rewired, `page.test.tsx` +296 / 11 new tests,
  `inquiry-starts/route.ts` −types → re-export).
- **Modules touched:** control-plane only (dashboard page + two pilot API route modules + page test).
  No SDK / ingest / decision-api / data / db-migration / docs / config touched.
- **Key contracts changed:**
  - `apps/control-plane/src/app/api/pilot/inquiry-starts/route-helpers.ts` — **NEW module** exporting
    `InquiryStartsResponse` + `DailyBreakdownRow` (extracted from `route.ts`, which now re-exports
    them for backward compat) — breaking: **no** (additive; `route.ts` keeps the same export names).
  - `apps/control-plane/src/app/dashboard/pilot/page.tsx` — **deletes** its duplicate local
    `CtaLiftResponse` / `InquiryStartsData` / `DailyBreakdownRow` interfaces and now imports the
    canonical types from the two `route-helpers` modules — internal-only contract; breaking: **no**.
  - No API route **signature** (path/method/response shape) changed — the routes already emitted
    `data_source` (FOLLOW-094 PR #153, FOLLOW-098 PR #155); this PR is purely the consumer wiring +
    a types-extraction refactor. — breaking: **no**.

### 2. Verification done in PR

- Test files changed: `apps/control-plane/src/app/dashboard/pilot/page.test.tsx` (+296, 11 new tests
  across 3 describe blocks: HTTP-500-fail-loud, mock-data-badge, clean-clickhouse-render).
- Assertions added: **11** RTL tests (`page.test.tsx:162-340`): 500 → `ErrorBanner` renders AND
  metric numbers are withheld (for both cta-lift and inquiry-starts independently); `data_source=mock`
  → `MockDataBadge` visible (both panels); `mock ≠ error` (numbers still render alongside the badge);
  `data_source=clickhouse` → no badge + no error banner + numbers render. The tests assert exactly the
  Rule K.2 consumer obligations (read status AND read provenance).
- Coverage delta: **+** for `page.tsx` (the new `FetchState<T>` branches, `ErrorBanner`,
  `MockDataBadge`, and the `!error` gating in all four panels are exercised). Net-positive.
- CI checks: merged on `main` as the head commit; the two-commit history shows the second commit
  fixed a real CI failure (TS2307 — the relative import path `../api/...` was wrong from
  `src/app/dashboard/pilot/`, corrected to `../../api/...`, and the workaround `eslint-disable` was
  removed once `route-helpers.ts` no longer pulled in `@estalara/auth`). Standing CI-gate caveat
  applies (Rule I / Vercel / Python lanes pre-existing-red & non-blocking, per the CI-gate-landscape
  memory).
- **AC verdict — clean.** The PR does exactly what FOLLOW-122 specified: imports the canonical type
  (kills the duplicate-interface drift root cause), renders a visible mock badge when
  `data_source !== 'clickhouse'`, and renders an error banner withholding all numbers on non-2xx. The
  central caveat is NOT in this PR's scope but in its blast radius: the sibling
  `/dashboard/analytics` page still carries the identical un-fixed defect (see §3 / §4 / §5).

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- New module `apps/control-plane/src/app/api/pilot/inquiry-starts/route-helpers.ts` — imported by a
  **real runtime consumer** (`page.tsx` `import type { InquiryStartsResponse, DailyBreakdownRow }`)
  AND re-exported by the sibling `route.ts` (`export type { ... } from './route-helpers'`). Non-test
  importers ≥ 1. **Not dead.**
- New page-local components `ErrorBanner` / `MockDataBadge` / wrapper type `FetchState<T>` — all
  referenced within `page.tsx` by the four panels. **Not dead.** **CHECK A clean ✅.**

**CHECK B — Half-wire detection (provenance signal `data_source` + HTTP-status as consumer inputs):**

- **Producer — EXISTS ✅ (pre-existing).** Both pilot routes emit `data_source: 'clickhouse' | 'mock'`
  and a fail-loud HTTP 500 (`cta-lift/route.ts:341-372` — unset URL → 200 mock with provenance; set
  but query throws → `Sentry.captureException` + `{ status: 500 }`; `inquiry-starts/route-helpers.ts`
  carries the same `data_source` field).
- **Consumer — NOW EXISTS ✅ for `/dashboard/pilot`.** `page.tsx` reads `res.ok`/status into
  `FetchState.error` and reads `data?.data_source !== 'clickhouse'` into `MockDataBadge`. The pilot
  page wire is **CLOSED** — this PR is precisely the consumer that RETRO-013 §3 / RETRO-015 §3 / Rule
  K.2 demanded. **No HALF_WIRE for the pilot path.**
- **HALF_WIRE_P (the producer-side gap on the SIBLING surface) — `/api/dashboard/analytics/lift`.**
  Inverse shape: the analytics lift route is a **producer that never emits provenance and never fails
  loud** — `route.ts` returns `NextResponse.json(response, { status: 200 })` (line 300) with a mock
  fallback on any failure and **no `data_source` field at all** (grep: `data_source` absent from
  `analytics/lift/route.ts`). Its consumer (`/dashboard/analytics/page.tsx`) therefore has nothing to
  read. This is **already tracked by FOLLOW-124** (Rule K.2 producer parity for that route) — NOT
  re-filed here. Noted for completeness; the NEW gap this retro files is the **consumer** half (below,
  §4a LG-1 → FOLLOW-142), which neither FOLLOW-123 nor FOLLOW-124 covers.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P1) — the EXACT defect this PR fixed for `/dashboard/pilot` is still live, unfixed, on the
  sibling `/dashboard/analytics/page.tsx`.** That page (a) carries **duplicate local interfaces**
  (`SummaryData`, `LiftRow`, `LiftData`, `ArchetypeBreakdownRow`, `BanditRow`, `AbWeightsData` at
  `page.tsx:23-62`) instead of importing canonical route types — the identical drift root cause
  FOLLOW-122 was created to eliminate; and (b) does **three** decision-grade fetches with the precise
  consumer-side fail-loud swallow Rule K.2 names: `fetch('/api/dashboard/analytics/summary')`
  (`page.tsx:451`), `fetch('/api/dashboard/analytics/lift')` (`:476`), and `fetch('/api/ab/weights')`
  (`:510`), each `.then((r) => r.json())` with **no `res.ok`/`res.status` guard** and a
  `.catch(() => { /* empty state */ })` that maps any failure (incl. a future HTTP 500 once FOLLOW-124
  lands) into a silent blank/empty panel. A go/no-go reviewer reading `/dashboard/analytics` cannot
  tell a 500 from "no data yet," and once FOLLOW-124 makes the route fail loud, the failure will be
  swallowed on the consumer exactly as RETRO-013 described for pilot. → **FOLLOW-142.** (P1, not P0:
  `/dashboard/analytics` is not named as the TICKET-PILOT-002 PRIMARY go/no-go surface — the pilot
  page is — but it is a decision-grade analytics surface and the route producer fix FOLLOW-124 is
  inert without it.)
- **LG-2 (P2) — the mock badge predicate is `data_source !== 'clickhouse'`, not `=== 'mock'`.** This
  is the safer choice (any non-`clickhouse`/`undefined` value flags as mock), and the type is a closed
  union, so today it is correct. Noted only so a future third enum member (e.g. `'cached'`) is
  consciously triaged into the badge logic rather than silently flagged as mock. No stub. → folded as
  a note.

#### 4b. Code bugs not caught

- N/A. The diff is a clean consumer-wiring + type-extraction refactor; the 11 new tests cover the
  three meaningful branches per panel (error / mock / clean) for both routes. No new bug introduced.

#### 4c. Test coverage gaps

- **TG-1 (P2) — no test asserts the `inquiry-starts/route.ts` re-export stays in sync with the
  extracted `route-helpers.ts`.** Today `route.ts` does `export type { ... } from './route-helpers'`
  so they cannot drift (single source). Low risk; only flagged because a future editor could re-inline
  a local copy in `route.ts` and reintroduce the duplicate-type drift FOLLOW-122 closed — exactly the
  Rule K-family recurrence. The canonical guard against this is the FOLLOW-142 work extending the
  pattern to analytics; no separate stub. → folded into FOLLOW-142 AC.
- **TG-2 (P2) — no negative test that a malformed-but-200 body (res.ok true, JSON parse OK, but
  missing `data_source`) renders sensibly.** The `data_source !== 'clickhouse'` predicate treats a
  missing field as mock (safe), but no test pins that behavior. Minor. → folded into FOLLOW-142 AC for
  the analytics consumer (apply the same defensive read there with a test).

#### 4d. Documentation gaps

- **DG-1 (P3) — Master Design §Snapshot.1 route inventory still does not list `/dashboard/pilot`,
  `/dashboard/analytics`, `/api/pilot/cta-lift`, `/api/pilot/inquiry-starts`, or
  `/api/dashboard/analytics/lift`.** This is the RETRO-008 DG-1 / FOLLOW-123 AC3 documentation debt,
  unchanged by this PR. Not re-filed — already an AC on FOLLOW-123. → tracked by FOLLOW-123.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-002 (Activation runbook + go/no-go checklist, BLOCKED, QUEUE.md ~L2313–L2317) — its
  data-provenance dependency is now SATISFIED for the PRIMARY surface.** The ticket's notes require
  the go/no-go checklist to include "the RETRO-008 §5a data-provenance check (dashboard shows
  `data_source: 'clickhouse'`, not `'mock'`) for the PRIMARY metric — otherwise the runbook could
  green-light a pilot whose lift number is fabricated." This PR makes `/dashboard/pilot` (the primary
  cta-lift + inquiry-starts surface) render a visible MOCK DATA badge and a fail-loud error banner, so
  a human running the runbook can now actually SEE provenance on the primary surface. **Dependency met
  for `/dashboard/pilot`.** Caveat for the architect authoring PILOT-002: if the runbook also points
  reviewers at `/dashboard/analytics`, that surface is NOT yet honest (§4a LG-1 / FOLLOW-142) — the
  runbook provenance check must name the **pilot** dashboard specifically, or wait on FOLLOW-142.
  Flagged here per constraint 3 for PM/architect attention.
- **FOLLOW-092 (verify cta.clicked producer→ClickHouse for pilot, BLOCKED) — unaffected by this PR but
  adjacent.** FOLLOW-092 verifies the upstream producer; this PR verifies the downstream human-surface
  read. Together they bracket the cta-lift wire. No new dependency.

#### 5b. Future sprint tickets affected

- **FOLLOW-124 (Rule K.2 fail-loud + `data_source` on `/api/dashboard/analytics/lift`, OPEN) — now has
  a consumer-side sibling, FOLLOW-142.** FOLLOW-124 makes the analytics route fail loud; without
  FOLLOW-142 the analytics PAGE will swallow that new 500 into a blank panel (the RETRO-013 defect, one
  surface over). The two should ship together or FOLLOW-142 immediately after — the route producer fix
  is only observable once the page consumer reads it. PM should sequence FOLLOW-124 → FOLLOW-142 (or
  bundle) before any go/no-go that trusts `/dashboard/analytics`.
- **FOLLOW-123 (parameterize analytics-lift window + Master Design route inventory, OPEN) — unchanged;
  carries the §4d DG-1 documentation debt.**
- **YELLOW Sprint 2–4 reserved stubs FOLLOW-132..138 — N/A.** FOLLOW-142 is a RED/pilot dashboard
  hardening item, not a YELLOW launch-readiness item; it belongs on the FOLLOW queue.

#### 5c. Contracts changed that other modules rely on

- **N/A for breaking changes.** The only cross-module-visible change is additive: a new
  `inquiry-starts/route-helpers.ts` exporting types that `route.ts` re-exports (so existing importers
  of `route.ts` are unaffected) and that `page.tsx` now consumes. The `data_source` provenance
  contract was already on the wire (FOLLOW-094 / FOLLOW-098); this PR only starts READING it.

#### 5d. Architectural assumptions affected

- **Rule K.2 consumer-side assumption (continuation of the RETRO-013/015 lineage):** RETRO-013/015
  established that a fail-loud producer paired with a swallowing consumer is the same defect one layer
  up. This PR is the **third** consumer-side instance (pilot cta-lift = RETRO-013, pilot inquiry-starts
  = RETRO-015, both now fixed here) and surfaces the architectural reality that **the fix was applied
  per-surface, not pattern-wide** — the analytics page is the surviving instance (§4a LG-1). The
  lesson: a consumer-swallow fix on one decision-grade page does not generalize; every page that
  fetches a decision-grade route needs the same `res.ok`-check + `data_source`-read treatment, and
  there is no shared fetch wrapper enforcing it. FOLLOW-142 closes the last known instance;
  a shared `fetchDecisionGradeJson()` helper would be the durable fix (noted, not filed — premature
  until a 4th surface appears).

### 6. New lesson candidates

- **Pattern (Rule K.2 consumer-side lineage) — "a decision-grade page fetches with
  `.then((r) => r.json())` and `.catch(() => emptyState)`, no `res.ok` guard, no `data_source` read —
  swallowing a fail-loud 500 into a blank/zeroed panel."** Evidence is now strong: RETRO-013 (pilot
  cta-lift), RETRO-015 (pilot inquiry-starts), RETRO-022 (this retro — both pilot panels fixed; the
  `/dashboard/analytics` instance newly identified). **Rule K.2 is ALREADY promoted in
  CONVENTIONS_PATCH.md and its §K.2 body and Verification grep already enumerate RETRO-013/015 and the
  exact consumer-side grep** (`.then((r) => r.json())` with no `res.ok` guard; expect ≥1 `data_source`
  read per decision-grade page). Per the no-double-promotion discipline (do NOT re-promote an existing
  rule on additional confirming occurrences), **Rule K.2 is NOT re-promoted.** This retro is logged as
  a confirming instance that strengthens it and demonstrates the rule's verification grep would have
  caught the analytics page (it returns the three un-guarded `analytics/page.tsx` fetches today). No
  CONVENTIONS_PATCH.md edit.
- **Pattern (new sub-shape) — "a consumer-side fix is applied per-surface, leaving an identical sibling
  surface un-fixed; no shared fetch wrapper enforces the contract."** This is a distinct shape (fix
  scope/generalization, not the swallow itself). Seen: RETRO-022 (this retro). Count = **1**. Below the
  promotion threshold (2). NOT promoted; recorded so a future second per-surface-only fix crosses it.

### 7. Follow-ups

- **FOLLOW-142** (backend-engineer, 2.5h, **P1**, sequence with/after FOLLOW-124, before any go/no-go
  trusting `/dashboard/analytics`): bring `/dashboard/analytics/page.tsx` to Rule K.2 consumer parity
  with the `/dashboard/pilot` page this PR fixed — import canonical route types (kill the duplicate
  local interfaces), add `res.ok`/status checks + a visible error state, and read `data_source` (after
  FOLLOW-124 emits it). Closes §4a LG-1; folds in §4c TG-1/TG-2. (`source_retro: RETRO-022`,
  `depends_on: FOLLOW-124`.)
- **Wave roll-up (final retro of Sprint 13a-hardening):** the four-retro wave (RETRO-019..022)
  hardened the pre-pilot gate and produced FOLLOW-139 (§13.2 90-day-localStorage erasure
  reality), FOLLOW-140 (§13.1 7-day consent-audit retention), FOLLOW-141 (pilot
  `inquiry_submit_selector` seed + corpus accuracy, **P0**), and FOLLOW-142 (analytics-page Rule K.2
  consumer parity). Net pre-pilot blocker for PM triage: **FOLLOW-141 is the lone P0** (the headline
  pilot conversion wire); FOLLOW-139/140/142 are P1. No separate RETRO-SPRINT summary is written — that
  is not an established convention in this file.

### 8. Cross-references

- **RETRO-013 (FOLLOW-094, PR #153)** — the source retro: RETRO-013 §3/§4 raised the cta-lift
  consumer-swallow (500 silently nulled, `data_source` emitted but unread). This PR is the
  `/dashboard/pilot` consumer fix RETRO-013 demanded; combined with closing RETRO-008 TG-2 (the
  provenance-read half of the go/no-go check).
- **RETRO-015 (FOLLOW-098, PR #155)** — sibling consumer-swallow on the inquiry-starts panel (the
  field-by-field `Number(d.x ?? 0)` mapper rendered the 500 body as a fabricated all-zeros panel).
  FOLLOW-122 fixes this panel too (the `inquiry-starts` half of this PR).
- **Rule K.2 (CONVENTIONS_PATCH.md)** — already promoted; this retro is a third confirming instance
  (consumer-side), NOT a re-promotion. The §K.2 Verification grep would flag the surviving
  `/dashboard/analytics/page.tsx` fetches (→ FOLLOW-142).
- **FOLLOW-124 (RETRO-014)** — the analytics-route producer fix; FOLLOW-142 is its consumer-side
  sibling. Sequence FOLLOW-124 → FOLLOW-142.
- **FOURTH and FINAL of four Sprint 13a-hardening (pre-pilot gate) retros** — siblings: RETRO-019
  (#159 / FOLLOW-139), RETRO-020 (#160 / FOLLOW-140), RETRO-021 (#161 / FOLLOW-141). Wave complete;
  P0 blocker is FOLLOW-141. See §7 wave roll-up.

---

<!-- RETRO-023 appended 2026-05-28 — content below. -->

## RETRO-023 — FOLLOW-139 (localStorage 90-day cross-session xid with erasure-on-withdrawal — §13.2 factual fix) — 2026-05-28

### 1. Summary of change

- **PR:** #164 (treated-as-merged per PM instruction 2026-05-28; not yet merged at retro time;
  branch `sdk-engineer/FOLLOW-139-localstorage-90day-xid-erasure`, commit unmerged). sdk-engineer;
  Sprint 13a-hardening-v2; `depends_on: FOLLOW-128, FOLLOW-129`. **CEO decision 2026-05-28: Option C
  (implement the real 90-day localStorage xid, NOT a docs-fix).** Source retro: **RETRO-019 §3
  HALF_WIRE_C** (the §13.2 disclosure-promised "90-day localStorage identifier deleted on
  Deny/Withdraw" that had zero producer in the SDK). This PR is the implementation half of that gap.
- **Files changed:** 4 (+246 / −27). Two SDK code files, one SDK test file, one compliance doc.
  - `packages/sdk/src/core/session.ts` (+106 / −0) — new module-level cross-session id surface.
  - `packages/sdk/src/index.ts` (+5 / −0) — `eraseCrossSessionId()` wired into `onDenied` callback
    + the `consentState === 'denied'` early-exit path.
  - `packages/sdk/src/__tests__/session.test.ts` (+109 / −7) — 6 new tests + dual storage mock.
  - `docs/compliance/dpia.md` (+26 / −20) — §13.2 balancing test flipped from "GREEN — contingent
    on FOLLOW-128 deployment" to "GREEN — unconditionally passed as of FOLLOW-139"; action-owner
    status COMPLETE; staging QA gate "READY FOR STAGING VERIFICATION"; key name `__estalara_xid__`
    threaded into the QA item; new dated footer.
- **Modules touched:** SDK only (core + UI-init wire + tests) + docs (compliance). No control-plane
  / ingest / decision-api / data / db-migration / config / event-schema touched.
- **Key contracts changed:**
  - `XSESSION_STORAGE_KEY = '__estalara_xid__'` — **new exported const** in `core/session.ts:131` —
    breaking: **no** (additive).
  - `interface CrossSessionId { id: string; created_at: number }` — **new exported type** at
    `core/session.ts:140-143` — breaking: **no** (additive).
  - `getOrCreateCrossSessionId(): Promise<CrossSessionId>` — **new exported function** at
    `core/session.ts:177` — breaking: **no** (additive; not yet imported by anything outside tests
    — see §3 CHECK A).
  - `eraseCrossSessionId(): void` — **new exported function** at `core/session.ts:220` — breaking:
    **no** (additive; consumed by `index.ts:20,94,124`).
  - DPIA §13.2 doc contract: balancing test transitioned from CONDITIONAL → UNCONDITIONAL GREEN
    based on this PR — a compliance/legal status flip; **not byte-for-byte aligned with code** in
    two ways (see §3 / §4).

### 2. Verification done in PR

- Test files changed: `packages/sdk/src/__tests__/session.test.ts` (+109 / −7).
- Assertions added: **6 new tests** in a `describe('cross-session id (localStorage)')` block at
  `session.test.ts:76-156`: (a) first-call creation persists `{id, created_at}` to localStorage;
  (b) returns same id within 90 days (in-memory cache flush + restore); (c) rotates id after 90 days
  via `vi.spyOn(Date, 'now')`; (d) `eraseCrossSessionId()` removes the localStorage key;
  (e) `eraseCrossSessionId()` clears the module-level in-memory cache so the next call generates
  fresh; (f) integration-shape test that the deny-path call sequence (create → erase) leaves the
  key absent. PR body cites 631 tests pass; 10 in `session.test.ts`. CI gates green per QUEUE.md
  yaml (Build, Lint, SDK E2E, Rule H/J, ClickHouse smoke, Doppler verify, Gitleaks, Auto-detection
  corpus).
- Coverage delta: **+** for `core/session.ts` (all four new exports + both the storage-OK and
  storage-throws fallback branches exercised). Net-positive; no obviously-uncovered new lines.
- CI checks: PR-body reports merge gates green; standing CI-gate caveat applies (Rule I / Vercel /
  Python lanes pre-existing-red & non-blocking, per the CI-gate-landscape memory).
- **Rule N verdict (the central caveat — see §3 / §4 / §6):** the 6 new tests prove the **producer
  surface and the eraser** work correctly **at the unit level when invoked**. They do NOT prove the
  producer is **invoked from the real init path** (nothing reads `getOrCreateCrossSessionId()` in
  production code — §3 CHECK A), and they do NOT enforce the "rotates monthly" cadence the banner
  + DPIA + Privacy Notice disclose (the code only rotates at the 90-day TTL boundary — §4a LG-1).
  So the §13.2 balancing-test flip to **unconditionally GREEN** rests on a producer that is
  technically present-but-uninvoked AND on a rotation cadence that does not match the disclosure.
  Per Rule N, the disclosure-to-behavior alignment must be byte-for-byte; it is not.

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- New exports in `packages/sdk/src/core/session.ts`:
  - `eraseCrossSessionId` — imported and called at `packages/sdk/src/index.ts:20,94,124` (two
    distinct real call sites: the `consentState === 'denied'` early-exit at `index.ts:93-95` and the
    `onDenied` banner-callback path at `index.ts:118-127`). Non-test importers ≥ 1. **Not dead.**
  - `XSESSION_STORAGE_KEY` and `CrossSessionId` — referenced only by the new tests
    (`session.test.ts:8,90,105,118,131-152`). At the symbol level these are consumed downstream of
    `getOrCreateCrossSessionId()` / `eraseCrossSessionId()` (the implementations use them), so they
    are **not dead in the strict sense** — they are colocated public surface for the test suite
    and forward-compat (e.g. a future tenant-side debug widget could read the key). **Not dead.**
  - `getOrCreateCrossSessionId` — **DEAD_CODE candidate, P1 → FOLLOW-143.** Grep `getOrCreateCrossSessionId`
    across `packages/` and `apps/`, excluding `node_modules` / `.next` / `__tests__` / `.test.ts` /
    `.spec.ts`, returns **ZERO non-test importers.** It is not called by `index.ts` (the post-consent
    init path goes `resetAdaptState()` → `getOrCreateSession()` → `incrementPageCount()` →
    `eventQueue.push(collectPageView())` at `index.ts:147-152` with no xid step), not by
    `core/events.ts` (events still ride `session.sessionId`, the existing `sessionStorage`
    fingerprint, at `events.ts:51,69`), not by `core/adapt.ts`, not by `core/dqs.ts`, and not by
    any ingest/decision-api consumer. **The 90-day localStorage value is never produced in any real
    browser session.** The `eraseCrossSessionId()` calls on the deny paths therefore `removeItem`
    a key that was never `setItem`'d. This is the inverse failure mode of RETRO-019: RETRO-019 found
    "no producer code at all"; this retro finds "producer code exists but is never invoked from
    production code paths." Net effect for the data subject is identical — **the disclosed 90-day
    `__estalara_xid__` localStorage entry never appears in real browsers.** → **FOLLOW-143** (P1,
    not P0 because the data-subject-facing failure here is "we promise X but never set X" which is
    a privacy-favorable over-disclosure, not a consumer NPE; classified P1 per the Step-6
    HALF_WIRE_P precedent that no-consumer/no-call situations are P1 while no-producer/consumer-
    expects-data is P0. See HALF_WIRE_P entry below for the canonical wire view.).

**CHECK B — Half-wire detection:**

- **HALF_WIRE_P — `sdk-symbol:getOrCreateCrossSessionId` / `storage-key:__estalara_xid__`.**
  - **Producer (code-level) — EXISTS ✅** at `packages/sdk/src/core/session.ts:177-208`. It performs
    the documented behavior correctly when invoked.
  - **Producer (call-site / wire-level) — DOES NOT EXIST.** No production caller invokes it (CHECK A
    above; grep). The key `__estalara_xid__` is never written by any path the browser actually
    executes. The eraser (`index.ts:94,124`) is wired but is targeting a key that was never created.
  - **Consumer — "the data subject" + the §13.2 disclosure** (DPIA + Privacy Notice + banner string)
    expects the key to exist; the FOLLOW-129 staging-QA gate ("verify `__estalara_xid__` is REMOVED
    after Deny") would falsely pass because the key is absent because it was never created, not
    because the eraser worked.
  - Priority **P1** → **FOLLOW-143** (per Step 6: HALF_WIRE_P is P1 because the gap does not break
    runtime — no consumer NPEs — but the disclosed feature is silently not delivered, and the §13.2
    balancing test that this PR flipped to GREEN now rests on a behavior the code does not perform).
- **HALF_WIRE — `disclosure-claim:rotation-cadence` (rotates monthly vs. 90-day TTL).** SECOND
  retro-discovered HALF_WIRE in this PR.
  - **Producer (code) — INCONSISTENT.** `core/session.ts:130-208` performs **single-step 90-day TTL
    replacement** (`Date.now() - parsed.created_at > XID_TTL_MS` → new UUID). There is no 30-day
    intermediate rotation step — the id is stable for up to 90 days, then replaced.
  - **Consumer-side disclosure — claims MONTHLY rotation in FIVE places:**
    1. `packages/sdk/src/ui/consent-banner.ts:146` (en): "_rotates monthly_"
    2. `consent-banner.ts:158` (pl): "_jest rotowany co miesiąc_"
    3. `consent-banner.ts:170` (es): "_rota mensualmente_"
    4. `docs/compliance/dpia.md:1039` (DPIA §13.2 mitigations): "rotates every 30 days (limiting
       staleness)"
    5. `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md:79`: "rotates automatically every 30 days"
  - **Pinned by a test** at `packages/sdk/src/__tests__/consent-banner.test.ts:508-514` —
    `expect(text).toMatch(/monthly/i);` — meaning the now-inaccurate cadence claim is locked in by
    a green test that asserts the SENTENCE renders, not that the behavior matches.
  - Priority **P0** → **FOLLOW-144**. This is **HALF_WIRE_C** for the data-subject (the
    disclosure-consumer reads "monthly rotation" but the code never rotates monthly) and is a
    **factual misstatement on the §13.2 lawful-basis disclosure**. The DPIA §13.2 balancing test
    was just flipped to unconditionally GREEN partly on the strength of this disclosure being
    accurate; it is not. Rule N already promoted in CONVENTIONS_PATCH.md off RETRO-018/019; this
    is a confirming instance on a **new sub-axis** (cadence mismatch within an otherwise-wired
    disclosure). Classified P0 because (a) it is the **same disclosure** the §13.2 LIA balancing
    test is conditioned on, and (b) data-subject-facing accuracy in a GDPR Art. 6(1)(f) disclosure
    is a hard go-live bar — the prior P0 (RETRO-019 FOLLOW-139) was triaged P0 on the same logic.

- **No new env var, DB column, Redpanda topic, or wire event introduced.** The new exports do not
  flow into ingest, decision-api, or ClickHouse. (This is a noteworthy gap on its own — see §5d.)

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P0) — "rotates monthly" disclosure vs. 90-day single-step TTL implementation.** Detailed
  in §3 HALF_WIRE_C. The disclosure says monthly (30-day) rotation; the code rotates only at the
  90-day boundary. This is not a documentation typo — it is a **functional behavior the code does
  not perform.** The DPIA §13.2 balancing-test passage rests on "rotates every 30 days (limiting
  staleness)" as one of its three mitigations; the implementation does not provide that mitigation,
  so the balancing-test "GREEN — unconditionally" status this PR shipped is not yet supportable on
  its own logic. → **FOLLOW-144 (P0)**.
- **LG-2 (P1) — `getOrCreateCrossSessionId()` is never invoked from the post-consent init path.**
  Detailed in §3 CHECK A / HALF_WIRE_P. The SDK init sequence at `index.ts:147-152` runs
  `getOrCreateSession()` (the sessionStorage path) but **NOT** `getOrCreateCrossSessionId()`. So
  although the producer code exists, no real browser session actually creates the disclosed
  `__estalara_xid__` key. The §13.2 disclosure remains factually inaccurate post-FOLLOW-139, just
  via a different mechanism than RETRO-019 found. → **FOLLOW-143 (P1)**. (P1 vs. P0 reasoning in
  §3: this is a non-delivery, not a misrepresentation; the user gets *less* tracking than disclosed,
  which is privacy-favorable but still a Rule N violation.)
- **LG-3 (P2) — `getOrCreateCrossSessionId()` returns `Promise<CrossSessionId>` but is fully
  synchronous internally** (no `await`, no async work — just `localStorage.getItem` /
  `Date.now()` / `crypto.randomUUID()`). The async signature is presumably forward-compat for a
  future async storage layer, but it is inconsistent with `getConsentState()` (sync) and slightly
  asymmetric with `getOrCreateSession()` (which is genuinely async because of
  `crypto.subtle.digest`). Low blast radius; noted only because Rule N's verification grep is
  insensitive to invocation shape and a future caller forgetting `await` would still get a Promise
  thenable. → folded into FOLLOW-143 AC as a doc note (not a separate stub).
- **LG-4 (P2) — the producer/eraser pair lives in `core/session.ts` but the existing module docblock
  (`session.ts:1-12`) describes "Session management — anonymous fingerprint, no PII" and
  "Session ID is a SHA-256 hex string derived from stable browser signals." The new addendum
  docblock (`session.ts:7-10`) was inserted but the FILE-LEVEL summary still describes the legacy
  sessionStorage fingerprint as the "Session ID" model.** Readers (incl. compliance auditors) get
  conflicting framing: is the canonical session id the SHA-256 sessionStorage value or the new UUID
  localStorage value? Both coexist; the docblock should make the dual-id model explicit. → folded
  into FOLLOW-143 AC, not a separate stub.

#### 4b. Code bugs not caught

- **CB-1 (P2) — `_xidCache` is module-level shared state, not per-session/per-tenant.** If the SDK
  is loaded twice on a page (improbable but not impossible — e.g. a publisher with two
  `<script>` tags pointing at two `data-api-key` values), both instances share the cache. Since
  `__estalara_xid__` is publisher-domain-bound by localStorage's same-origin rules, this is correct
  by design *for that domain* — but a multi-tenant test harness or an SSR-then-CSR hand-off could
  observe stale cache. Low severity; noted because the test suite manually flushes the cache
  between tests via `eraseCrossSessionId()` (`session.test.ts:82`), which works but is a leaky
  detail. Not stub-worthy.
- **CB-2 (P2) — `crypto.randomUUID()` fallback uses `Math.random()`-based v4 UUID** (`session.ts:155-162`).
  This is non-cryptographically-random. For an anonymous pseudonymous id with no
  re-identification guarantee, this is acceptable, but the §13.2 LIA framing implies "pseudonymous"
  with HMAC-grade entropy (lia-template.md / DPIA §13.2 use HMAC language for the
  sessionStorage fingerprint). The new xid is *not* HMAC-derived (no `tenant_secret`, no salting),
  and its fallback path is `Math.random`. If a future audit asks "is the id cryptographically
  pseudonymous," only the primary path (`crypto.randomUUID()`) is. Noted for the future audit;
  folded into FOLLOW-143 AC as a docs/clarification note.
- **CB-3 (P2) — `eraseCrossSessionId()` does NOT erase the legacy `__estalara_session__`
  sessionStorage fingerprint nor the `estalara_consent` localStorage entry on deny.** The §13.2
  disclosure promises "deleted if you withdraw consent"; the strict reading is the xid is deleted.
  But a data-subject reading the banner reasonably expects ALL pseudonymous identifiers to be
  erased on a deny — and the legacy sessionStorage fingerprint is still present until the tab
  closes (and `estalara_consent='denied'` lingers indefinitely so the user is not re-prompted).
  Strict GDPR Art. 17 (right to erasure) reading: a withdrawal should erase ALL tracking
  identifiers, not just the new one. This is a continuation of RETRO-019 §3's broader finding.
  → folded into FOLLOW-143 AC (the erasure path should clear `__estalara_session__` from
  sessionStorage AND optionally the consent state if a re-prompt cycle is desired; if NOT, the
  disclosure should be tightened to name the specific keys retained).

#### 4c. Test coverage gaps

- **TG-1 (P0) — no test asserts `getOrCreateCrossSessionId()` is INVOKED from `index.ts`'s real
  init path.** All 6 new tests call the function directly from the test file. The integration test
  (`session.test.ts:146-154`) simulates ONLY the deny-path eraser, not the create-on-grant path.
  So nothing in the suite would catch the LG-2 / §3 HALF_WIRE_P (the function is never called from
  production code) — and this is precisely what slipped past PR review. → FOLLOW-143 AC includes
  an integration-level assertion that on a granted consent path the `__estalara_xid__` key IS
  present in localStorage after init (E2E or jsdom integration test on `index.ts`).
- **TG-2 (P0) — no test asserts the 30-day rotation cadence the disclosure promises.** The existing
  rotation test rotates at 91 days (`session.test.ts:111-128`), which proves the *90-day TTL*
  behavior — the OPPOSITE of what the disclosure claims. A test that asserts a 30-day rotation
  step would have failed and surfaced LG-1 / §3 HALF_WIRE_C before the GREEN flip. → FOLLOW-144 AC.
- **TG-3 (P1) — no test asserts the `eraseCrossSessionId()` call sequence runs on the EARLY-EXIT
  deny path** (`index.ts:93-95`, where a returning denied user lands without rendering the banner).
  The PR adds this call but its only test coverage is the in-banner `onDenied` callback path. A
  jsdom test that pre-seeds `localStorage.estalara_consent='denied'` and asserts the xid is removed
  on init would close this. → folded into FOLLOW-143 AC.

#### 4d. Documentation gaps

- **DG-1 (P0) — DPIA §13.2 line 1039 says "rotates every 30 days" while the implementation rotates
  at 90 days.** This sentence is in the LIA balancing-test mitigations paragraph that conditions
  the GREEN status. The PR did not update line 1039 (it updated lines 1045-1057 + 1079-1086 to
  reflect FOLLOW-139). So the DPIA is now internally inconsistent: §13.2 paragraph 3 says 30-day
  rotation; §13.2 paragraph 4 (this PR's edit) claims unconditional GREEN passage. → FOLLOW-144 AC.
- **DG-2 (P0) — `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md:79` says "rotates automatically every
  30 days"** — same root issue, different file. The tenant-facing template directly inherits the
  inaccurate cadence claim. Any tenant who publishes the privacy notice carrying this template
  ships an inaccurate disclosure to their data subjects. → folded into FOLLOW-144 AC.
- **DG-3 (P0) — Banner copy (en/pl/es) at `consent-banner.ts:145-170` says "rotates monthly"** —
  same root issue, three locales, locked by a test (`consent-banner.test.ts:513` matches `/monthly/i`).
  The fix must touch all three locales **and** update the matching `consent-banner.test.ts` regex
  (the test will fail when the wording is corrected). → folded into FOLLOW-144 AC.
- **DG-4 (P2) — Master Design §Snapshot.1 line 8 + the broader Master Design fingerprint model
  (lines 2413, 2487, 4338) describe a session_id that is "HMAC-derived with day_bucket, rotates
  every 24h" — referring to the legacy `__estalara_session__` sessionStorage fingerprint.** Master
  Design does not yet acknowledge the **dual-id model** this PR introduces (legacy sessionStorage
  HMAC fingerprint + new localStorage UUID xid). A reader of Master Design would not know the new
  xid exists. → folded into FOLLOW-143 AC.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13b Lane B, READY) — the §13.2 EU go-live blocker the PR claims to
  close remains OPEN on two new sub-axes** (LG-1 / FOLLOW-144 cadence mismatch P0; LG-2 / FOLLOW-143
  producer-never-invoked P1). The §13.2 balancing test flip to unconditionally GREEN that this PR
  shipped is **premature** — the lawful-basis disclosure is still factually inaccurate. PM must
  treat **FOLLOW-144 (P0)** as a new EU-go-live blocker layered on top of where FOLLOW-139 was
  thought to close it; and **FOLLOW-143 (P1)** as a should-fix-before-go-live (the disclosed
  feature is silently not delivered). Flagging here per constraint 3 for PM/CEO attention — the
  GREEN flip should be reverted to CONDITIONAL until FOLLOW-143/144 land. **The §13.2 lawful-basis
  disclosure is currently a fresh Rule N violation, generated by the PR that was supposed to close
  the prior Rule N violation.**
- **TICKET-PILOT-002 (go/no-go runbook, BLOCKED) — the EU pre-flight `localStorage QA` gate
  references the right key name now (`__estalara_xid__` at `dpia.md:1082`), but the gate is still
  unexecutable in the same way RETRO-019 §5a flagged: a tester would observe that the key never
  appears on a granted session (LG-2) and never gets removed because it was never set
  (consequence of LG-2). The "remove on Deny" verification falsely passes. The runbook gate must
  be tightened to assert KEY-PRESENT after grant AND KEY-ABSENT after deny — both halves, not just
  the post-deny absence. → folded into FOLLOW-143 AC3.
- **FOLLOW-140 (deferred Sprint 14, §13.1 7-day retention enforcement) — adjacent, NOT a
  Withdraw-button ticket.** The user's framing (in the prompt) suggested FOLLOW-140 covers a future
  Withdraw button. Verified: FOLLOW-140's scope (`backlog/FOLLOW_UPS.md:3729-3766`) is the §13.1
  7-day consent-audit-log retention/TTL — **NOT** a UI Withdraw button. **There is currently NO
  tracked ticket for a Withdraw button surface anywhere in QUEUE.md or FOLLOW_UPS.md** (grep
  `withdraw`/`Withdraw` button in QUEUE/FOLLOW_UPS returns nothing). The PR's `eraseCrossSessionId()`
  export is documentation-correct as a forward-compat hook for that future button, but the button
  itself is not on any plan. If the §13.2 disclosure ("deleted if you withdraw consent") expects
  there to BE a withdraw mechanism, the SDK must eventually offer one — currently a visitor cannot
  withdraw without programmatic intervention. → **FOLLOW-145 (P2)** — file a tracking stub for the
  Withdraw button (or a "Reopen consent banner" affordance) that calls `eraseCrossSessionId()`.
  Sprint 14 or later; P2 because the §13.2 LIA does not technically REQUIRE a withdraw button
  (Art. 7(3) requires withdrawal be "as easy as giving consent"; for a denied user the question
  is moot, but a GRANTED user has no UI to revoke today).
- **FOLLOW-141 (P0, PR #165, sibling in same Sprint 13a-hardening-v2) — unrelated to this PR's
  surface; not affected.**

#### 5b. Future sprint tickets affected

- **FOLLOW-092 (TICKET-PILOT-001 shadow-window measurement, BLOCKED) — directly affected.** RETRO-019
  §5b flagged that if §13.2 resolves toward sessionStorage-tab-lifetime, cross-session measurement
  assumptions need revisiting. CEO chose Option C (real 90-day xid) — but this PR did not actually
  wire the xid into the measurement path. Specifically: the xid does NOT flow into any event
  payload (`packages/sdk/src/core/events.ts:51,69` still uses the legacy `session.sessionId`
  sessionStorage fingerprint as `session_id`/`x-session-id`); the xid does NOT flow into the
  ingest layer (no consumer in `apps/ingest/src/`); and the xid does NOT flow into ClickHouse
  (no schema field). So **the headline cross-session-continuity USE case the Option C decision was
  meant to enable is not actually built** — the xid is a stand-alone client-side artifact today.
  FOLLOW-092 (shadow-window measurement of cross-session conversion) cannot use it. → **FOLLOW-146
  (P1)** — actually use the xid: thread it onto event payloads / into the session join key, with
  a measurement decision on whether the legacy sessionStorage fingerprint or the new
  localStorage xid is the canonical cross-session join key.
- **YELLOW Sprint 2–4 stubs FOLLOW-132..138 — N/A directly.** FOLLOW-143/144/145/146 are all
  pilot-readiness / compliance-accuracy items, not YELLOW launch-readiness items; they belong on
  the FOLLOW queue.

#### 5c. Contracts changed that other modules rely on

- **N/A for breaking changes.** The new exports are additive. The only cross-module-visible
  contract change is the **DPIA §13.2 status flip from CONDITIONAL → UNCONDITIONAL GREEN**, which
  is a compliance/legal contract change downstream consumers (DPO, EU pilot review, audit) rely on
  — and that flip is currently unjustified by the shipped behavior (§3, §4a LG-1). The
  pseudo-contract "the xid is a cross-session join key" is undercut by the fact that the xid never
  appears on the wire (§5b).

#### 5d. Architectural assumptions affected

- **GDPR/DPIA assumption (continuation of RETRO-018/019/020 §5d lineage):** RETRO-018 = string
  absent; RETRO-019 = behavior absent; RETRO-020 = retention claim unenforced; **THIS retro =
  behavior PARTIALLY present (the code exists) but disconnected from the runtime path AND
  diverges from the disclosed cadence.** The Rule N parent shape now has FOUR consecutive
  occurrences across four PRs, with a striking pattern: each fix introduces a NEW failure mode of
  the same shape, exposing a deeper layer of mismatch. The architectural lesson is that
  **disclosure-driven implementation in 1-PR increments is insufficient** — the §13.2 surface
  needs a single, all-or-nothing reconciliation pass that aligns FIVE artifacts (banner copy ×3
  locales, DPIA §13.2 body, Privacy Notice §3) AND the implementation AND the runtime invocation
  AND the wire/measurement side, all at once. The next FOLLOW (144 + 143 + 146) should be
  scope-merged or sequenced atomically.
- **Master Design dual-id model gap (NEW):** Master Design's session model (lines 2413, 2487,
  4338) describes ONE session id: HMAC-derived sessionStorage fingerprint with 24h day_bucket
  rotation. The new `__estalara_xid__` is a SECOND, parallel identifier with different storage
  (localStorage), different generation (UUID, not HMAC), different TTL (90 days, not 24h), and
  different rotation cadence (claimed monthly per disclosure, implemented 90-day TTL per code,
  none per Master Design). Master Design does not acknowledge this dual-id model. → FOLLOW-143
  AC4 (Master Design §B / §Snapshot.1 update OR a new ADR documenting the dual-id model).

### 6. New lesson candidates

- **Pattern N (compliance doc asserts behavior the code does not implement) — FOURTH consecutive
  occurrence.** RETRO-018 (string absent) + RETRO-019 (behavior absent — sessionStorage vs
  localStorage) + RETRO-020 (retention claim unenforced — §13.1 7-day) + RETRO-023 (this retro —
  TWO new sub-axes: producer never invoked from init path, and rotation cadence claim diverges
  from TTL behavior). **Rule N already promoted in CONVENTIONS_PATCH.md (515-548) by RETRO-019.**
  Per the no-double-promotion discipline (do NOT re-promote an existing rule on additional
  confirming occurrences), **Rule N is NOT re-promoted.** This retro is logged as a fourth
  confirming instance, *strongly* reinforcing the rule's verification grep — which, applied to
  this PR pre-merge, would have caught both LG-1 (rotation cadence) and LG-2 (producer not
  invoked):
  - `grep -rn "rotates monthly\|every 30 days\|rotates every"` cross-referenced against
    `grep -rn "XID_TTL_MS\|90 \* 24 \* 60"` in `packages/sdk/src/` would show a cadence mismatch.
  - `grep -rn "getOrCreateCrossSessionId" packages/ apps/ --include="*.ts" | grep -v "__tests__"`
    returns zero non-test importers — direct evidence of LG-2.
  - The pattern points to a Rule N strengthening that is **already inside the existing rule's
    verification block** (lines 538-548 require "each disclosure SENTENCE the DPIA/Privacy Notice
    mandates must appear in the banner COPY constant" AND "if a doc says 'deleted if you withdraw
    consent,' there MUST be a removeItem on the onDenied/withdraw path"). What the existing rule
    does NOT yet enumerate is the **cadence-mismatch** sub-shape ("if a doc says 'rotates monthly'
    there MUST be a 30-day step in the rotation logic"). This is a candidate for a small
    **Rule N AMENDMENT** that adds a cadence-check grep — NOT a new rule. Per the project's
    Rule-H-amendment precedent (CONVENTIONS_PATCH.md 223-313 shows Rule H received two retro-driven
    amendments), an amendment is appropriate when the parent rule reaches its third or fourth
    confirming instance and the new sub-shape is a specific verification step not already covered.
    Count of the cadence-mismatch sub-shape = **1** (this retro). Below the dedicated promotion
    threshold of 2 for a standalone rule, but reaching the Rule-N parent shape's fourth occurrence
    is grounds for an amendment. **Amendment is added below** (Rule N amendment 2026-05-28).
- **Pattern (new sub-shape, distinct from Rule N) — "the source-retro's HALF_WIRE was closed
  symbol-level but the symbol is not invoked from the production code path it was designed to
  serve."** RETRO-019's gap was "no `getOrCreateCrossSessionId` code at all." FOLLOW-139 adds the
  code but does NOT wire it into `init()`. So the *symbol-level* HALF_WIRE is closed; the
  *call-site-level* HALF_WIRE is new. This is a distinct, narrower shape than Rule N (it is
  about *symbol-vs-callsite* wiring, not *doc-vs-code* matching). Seen: RETRO-023 (this retro).
  Count = **1**. Below the promotion threshold (2). NOT promoted; recorded so a future second
  occurrence (e.g. another "new export exists but no real caller") crosses the threshold and
  potentially becomes Rule O.

### 7. Follow-ups

- **FOLLOW-143** (sdk-engineer, 2h, **P1**, before EU/pilot go-live): Wire
  `getOrCreateCrossSessionId()` into the SDK's post-consent init path so the disclosed
  `__estalara_xid__` localStorage entry actually appears in real browser sessions, and tighten the
  related docblocks + Master Design. Closes §3 CHECK A DEAD_CODE / HALF_WIRE_P, §4a LG-2/LG-3/LG-4,
  §4b CB-3, §4c TG-1/TG-3, §4d DG-4. (`source_retro: RETRO-023`, `depends_on: FOLLOW-139`.)
- **FOLLOW-144** (sdk-engineer + compliance-engineer, 2h, **P0**, before EU pilot go-live):
  Reconcile the "rotates monthly" / "rotates every 30 days" disclosure across the consent banner
  (3 locales), DPIA §13.2 line 1039, and Privacy Notice §3 line 79 with the **actual** 90-day TTL
  implementation — either (a) implement a separate 30-day rotation step in `getOrCreateCrossSessionId`
  and add a test asserting the cadence, OR (b) correct all five disclosure surfaces to "every 90
  days" / "every three months" and update the `consent-banner.test.ts:513` `/monthly/i` regex.
  Closes §3 HALF_WIRE_C, §4a LG-1, §4c TG-2, §4d DG-1/DG-2/DG-3. (`source_retro: RETRO-023`,
  `depends_on: FOLLOW-139`.)
- **FOLLOW-145** (sdk-engineer, 3h, **P2**, Sprint 14 or later): File the Withdraw-button /
  Reopen-consent-banner UI affordance — a granted user currently has no in-product mechanism to
  revoke consent, so the §13.2 "deleted if you withdraw consent" disclosure has no executable user
  path. The new `eraseCrossSessionId()` export is forward-compat for this button; the button
  itself needs designing (placement, copy in 3 locales, accessibility) and wiring into the same
  erasure sequence as `onDenied`. (`source_retro: RETRO-023`, `depends_on: FOLLOW-139,FOLLOW-143`.)
- **FOLLOW-146** (sdk-engineer + data-engineer, 4h, **P1**, before/during Sprint 14 cross-session
  measurement work): Actually USE the xid — thread the localStorage `__estalara_xid__` onto event
  payloads and into the ingest/ClickHouse session-join key (or decide that the legacy
  sessionStorage `session.sessionId` remains the canonical join key and the xid is purely a
  client-side cookie-like marker, in which case the §13.2 LIA "cross-session journey continuity"
  rationale needs softening). Without this, the Option C decision to "implement the real 90-day
  cross-session id" is half-built: the id exists in localStorage but never travels with events,
  so cross-session continuity is not actually achievable. Closes §5b FOLLOW-092 dependency.
  (`source_retro: RETRO-023`, `depends_on: FOLLOW-139,FOLLOW-143`.)

### 8. Cross-references

- **RETRO-019 (FOLLOW-129, PR #159)** — direct parent. RETRO-019 §3 emitted FOLLOW-139 to reconcile
  the §13.2 doc-vs-code gap. This PR implements FOLLOW-139, but RETRO-023 finds the reconciliation
  is incomplete on TWO new axes (LG-1 cadence, LG-2 producer not invoked) plus does not yet
  satisfy the §13.2 "cross-session continuity" *purpose* (§5b — xid not on the wire).
- **RETRO-018 / RETRO-020 (FOLLOW-118-121 PR #158 / FOLLOW-128 PR #160)** — Rule N lineage parents.
  RETRO-023 is the FOURTH consecutive Rule N instance. The verification grep in CONVENTIONS_PATCH.md
  Rule N (lines 538-548) would have caught LG-1 and LG-2 if extended slightly — see §6 amendment.
- **CONVENTIONS_PATCH.md Rule N (lines 515-548)** — already promoted (RETRO-019); RETRO-023 is a
  confirming instance, NOT a re-promotion. AMENDMENT added below for cadence-mismatch sub-shape.
- **First retro of Sprint 13a-hardening-v2** — sibling: RETRO-024 (still-to-write, for PR #165 /
  FOLLOW-141). This is the second wave of pre-pilot hardening retros after the four-PR Sprint
  13a-hardening wave (RETRO-019..022). The wave's name "v2" is fitting: RETRO-023 shows the v1 fix
  introduced its own Rule N gap.

---

## RETRO-024 — FOLLOW-141 (Seed inquiry_submit_selector on pilot tenant — partial: AC1 only) — 2026-05-28

### 1. Summary of change

- **PR:** #165 (treated-as-merged per PM instruction 2026-05-28; not yet merged at retro time;
  branch `backend-engineer/FOLLOW-141-pilot-inquiry-selector`, commit unmerged). backend-engineer;
  Sprint 13a-hardening-v2; `depends_on: FOLLOW-127`. Source retro: **RETRO-021 §3 HALF_WIRE_C / §4a
  LG-1 (P0)** — the pilot-row `inquiry_submit_selector` lacked a committed seed; the value lived
  only in the SDK auto-detect test fixture.
- **Files changed:** 3 (+171 / −0).
  - `packages/db/migrations/0016_pilot_inquiry_selector.sql` (new, +48) — idempotent `jsonb_set`
    `UPDATE` on `tenant_site_schemas.schema` setting
    `inquiry_submit_selector = "[data-estalara-slot='inquiry-submit']"` where the field is currently
    `NULL` or `""` AND `tenant_id = (SELECT id FROM tenants WHERE slug = '000-app-estalara' AND deleted_at IS NULL LIMIT 1)`.
  - `packages/db/migrations/meta/_journal.json` (+7) — Drizzle journal entry
    `idx=16, tag=0016_pilot_inquiry_selector, version=7, when=1748736000000`.
  - `packages/db/src/__tests__/pilot_inquiry_selector.test.ts` (new, +116) — 13 structural unit
    tests (SQL-text assertions + journal-shape; no live DB exercise).
- **Modules touched:** db (packages/db: 1 new migration + 1 journal update + 1 new test file). No
  SDK / ingest / decision-api / control-plane / data / docs / config touched.
- **Key contracts changed:**
  - Pilot-tenant data state (runtime row, not type signature):
    `tenant_site_schemas.schema->>'inquiry_submit_selector'` becomes
    `"[data-estalara-slot='inquiry-submit']"` after the migration is applied to a database whose
    `tenants` table contains a row with `slug = '000-app-estalara' AND deleted_at IS NULL`.
    Breaking: **no** (additive JSONB key insert; no other tenant rows touched).
    **Behaviorally contingent — see §3/§4a/§5a:** the migration is a silent no-op if the pilot
    tenant's actual `slug` is anything other than `'000-app-estalara'`.
  - No schema-shape, no API-route, no SDK-public-symbol, no migration-table-DDL changed (this is a
    pure data-seed forward migration).

### 2. Verification done in PR

- Test files changed: `packages/db/src/__tests__/pilot_inquiry_selector.test.ts` (new, +116).
- Assertions added: **13** structural tests across 2 `describe` blocks
  (`pilot_inquiry_selector.test.ts:31-89` migration SQL; `:99-115` journal entry): file exists &
  non-empty; contains the slug `'000-app-estalara'`; uses `jsonb_set` with the
  `{inquiry_submit_selector}` path; embeds `data-estalara-slot` + `inquiry-submit`; passes `true`
  for `create_missing`; has both `IS NULL` and `= ''` guards; uses `SELECT id FROM tenants` (not a
  hardcoded UUID); regex-asserts no raw-UUID `WHERE tenant_id = '...'` pattern; checks
  `deleted_at IS NULL`; journal entry exists at `idx=16` with `version='7'`. PR-reported test
  summary: **52 tests pass across 5 files in `packages/db`** (entire package green).
- Coverage delta: **+** for the migration text itself (13 assertions on a 48-line SQL file). **Net
  ZERO actual DB-behavior coverage** — no test exercises the SQL against Postgres; the migration's
  effect on a real row is not verified by CI. See §4c TG-1.
- CI checks: PR open, not yet merged; pre-commit/pre-push hooks reported green (format, lint,
  commitlint, Rule H, Rule J — per PR description). Standing CI-gate caveat applies (Rule I /
  Vercel / Python lanes pre-existing-red & non-blocking, per the CI-gate-landscape memory). **PM
  obligation:** run `gh pr checks 165 --watch` before marking READY_FOR_REVIEW (Rule A).
- **AC verdict — PARTIAL.** FOLLOW-141 has three ACs; this PR addresses **AC1 only** (committed
  reproducible artifact for the pilot row), and that AC is itself **conditional** (see §3 / §4a).
  **AC2 (corpus harness scores `finalSchema.inquiry_submit_selector`) and AC3 (probe-vs-AI-Vision
  precedence documented + tested + recorded in MASTER_DESIGN §B or a detection ADR) are NOT
  implemented in this PR.** No edit to `packages/sdk/src/auto-detect/test-utils.ts` (the scoring
  loop at `:550-568` still iterates per-field `detected[fieldKey]` and never reads the top-level
  field); no edit to `docs/MASTER_DESIGN.md` §B; no test asserting probe-vs-LLM precedence in
  `packages/sdk/src/auto-detect/__tests__/`. This is a real gap — see §4a LG-2 / §4c TG-2 →
  carried forward as FOLLOW-147 + FOLLOW-148.

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- `packages/db/migrations/0016_pilot_inquiry_selector.sql` — discovered by the Drizzle migration
  runner (`packages/db/scripts/migrate.ts:21` calls
  `migrate(db, { migrationsFolder: './migrations' })` against `_journal.json`), NOT by source
  `import`. Framework-discovered entrypoint — **suppressed false positive** per Step 6 rules.
  **Not dead.**
- `packages/db/migrations/meta/_journal.json` — read by drizzle-orm at runtime + by the new
  `pilot_inquiry_selector.test.ts` directly. **Not dead.**
- `packages/db/src/__tests__/pilot_inquiry_selector.test.ts` — test file, picked up by vitest.
  **Not dead.** **CHECK A clean ✅.**

**CHECK B — Half-wire detection (`tenant_site_schemas.schema->>'inquiry_submit_selector'` on the pilot row):**

- **General path (NOT pilot-specific, established by FOLLOW-127 / PR #161, re-verified):**
  Producer EXISTS ✅ at `packages/sdk/src/auto-detect/pipeline.ts:121-123` (probe) +
  `packages/sdk/src/auto-detect/techniques/ai-vision.ts:250` (AI Vision); persist hop EXISTS ✅
  via `/api/detect` + `/api/schema/activate`; Consumer EXISTS ✅ at
  `packages/sdk/src/index.ts:381` → `core/observer.ts:147`. The general wire was already closed by
  RETRO-021's PR.
- **Pilot-row path (RETRO-021 HALF_WIRE_C — the gap this PR was created to close):**
  - **Producer (NEW this PR) — EXISTS but BEHAVIORALLY CONTINGENT ⚠.** Migration 0016 writes
    `inquiry_submit_selector` into the pilot row IFF the
    `SELECT id FROM tenants WHERE slug = '000-app-estalara' AND deleted_at IS NULL LIMIT 1`
    sub-query resolves to a real id. **The slug `'000-app-estalara'` is NOT verified to be the
    pilot tenant's actual slug anywhere in the codebase.** Grep across
    `packages/db/migrations/**`, `packages/db/src/seed/**`, `apps/control-plane/scripts/**`, and
    `apps/control-plane/src/lib/**` finds the literal `'000-app-estalara'` ONLY in (a) SDK
    auto-detect corpus fixtures (`packages/sdk/src/auto-detect/__fixtures__/000-app-estalara/`),
    (b) backlog/QUEUE.md documentation, and (c) **this migration**. There is NO committed
    INSERT/seed that creates a `tenants` row with `slug = '000-app-estalara'`. The pilot tenant is
    documented as `DEMO_TENANT_ID` (`docs/ops/PILOT_FREEZE_RULE.md:69-74`), an env-var UUID set at
    runtime — whatever `slug` was given to that row at registration time (via Magic Link wizard or
    manual creation) is **unverifiable from this repo**. → **HALF_WIRE_P (NEW sub-axis) — priority
    P0** → **FOLLOW-147**. If the pilot row's `slug` is, say, `'app-estalara'` or `'pilot'` or
    `'estalara'`, the migration runs successfully (no error, idempotent WHERE guard is satisfied
    trivially because zero rows match), `db:migrate` reports "Migrations applied successfully",
    and the pilot Observer reads `undefined` exactly as in RETRO-021 — but now with a green
    migration journal masking the gap. **This is the same HALF_WIRE_C → HALF_WIRE_P shape, one
    layer deeper.**
  - **Consumer — EXISTS ✅ (unchanged).** `packages/sdk/src/index.ts:381` reads
    `inquirySubmitSelector` from `SdkConfig`, threads it into `setupObservers()`, and
    `core/observer.ts:147` registers the delegated click listener only if the value is truthy. The
    consumer correctly silently degrades when undefined — which is the silent-no-op risk above.

**Summary:** The migration is a **conditional half-wire** — the producer-side hop fires only if a
runtime invariant (pilot row's slug literal) matches. This is a strictly weaker close of the
RETRO-021 HALF_WIRE_C than the AC1 wording implies. Filed as HALF_WIRE_P P0 → FOLLOW-147.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P0) — slug `'000-app-estalara'` is an unverified assumption.** The migration's
  correctness is gated on a runtime fact (the pilot tenant's `slug` column value) that has no
  committed source. `docs/ops/PILOT_FREEZE_RULE.md:69-74` defines the pilot tenant via
  `DEMO_TENANT_ID` (an env-var UUID) and explicitly notes "the UUID is discoverable post-PILOT-001
  via `SELECT id, slug, status FROM tenants WHERE id = current_setting('app.demo_tenant_id')`" —
  meaning the slug is data-of-the-database, not data-of-the-repo. If the operator who ran Magic
  Link onboarding gave the pilot a different slug (e.g., `app-estalara`, `estalara-pilot`,
  `production`), the migration silently no-ops on prod. Impact: TICKET-PILOT-001 ships with the
  inquiry-conversion wire still inert and FOLLOW-092 measures zero inquiries — the exact failure
  RETRO-021 was raised to prevent. Mitigation must be a verification step that runs BEFORE the
  migration is treated as resolving FOLLOW-141 (either a pre-apply SELECT confirming a matching
  row exists, or a post-apply assertion confirming the JSONB key landed). → **FOLLOW-147 (P0).**
- **LG-2 (P1) — FOLLOW-141 AC2 + AC3 are unfulfilled and not split out as a separate stub.** The
  source ticket's three ACs cover (1) a real pilot-row value, (2) corpus harness scoring of the
  new field with ≥1 real-corpus L2–L7 site, and (3) probe-vs-AI-Vision precedence documented +
  tested + recorded in MASTER_DESIGN §B / a detection ADR. This PR implements **only AC1**. AC2 is
  the measurement gate RETRO-021 §4c TG-1 raised — without it, the L2–L7 heuristic ladder remains
  unmeasured against real sites and the next platform onboarding (an SDK consumer) gets no
  CI-asserted accuracy floor. AC3 is the architectural-decision-record gate RETRO-021 §4a LG-2 /
  §4d DG-1 raised — without it, the next auto-detect editor will re-discover the implicit
  probe-overrides-LLM precedence by reading source. Neither AC is filed as a follow-up by the
  worker; the PR description does not even acknowledge them. → **FOLLOW-148 (P1).**
- **LG-3 (P2) — `_journal.json:113` carries `"when": 1748304000000` (Jan 2025 UTC) for migration
  0015 — a `when` value that is EARLIER than entries 0011..0014 (1778–1779M range, i.e., 2026-mid).**
  Migration 0016 (this PR) sets `"when": 1748736000000` which is also a 2025 timestamp, BUT it is
  later than 0015's, so the relative ordering within the new pair is correct. This is an inherited
  typo (probably from a prior commit) — Drizzle uses `idx` for ordering, not `when`, so it is
  functionally harmless. Flagged only because the next migration author will copy one of these and
  propagate the typo. Noted, no follow-up filed (cosmetic).

#### 4b. Code bugs not caught

- **CB-1 (P2) — the test at `pilot_inquiry_selector.test.ts:74` is a tautology.** The test reads:
  ```ts
  it('expected selector value matches the ground-truth fixture', () => {
    expect("[data-estalara-slot='inquiry-submit']").toBe("[data-estalara-slot='inquiry-submit']");
  });
  ```
  This asserts a string equals itself; it cannot fail and provides zero coverage of the cross-check
  it claims to perform (the comment promises a "cross-check against the 000-app-estalara fixture in
  `packages/sdk/src/auto-detect/__fixtures__/000-app-estalara/detail-ground-truth.json` field 19").
  The actual cross-check would be `readFileSync(fixturePath); JSON.parse(...); expect(parsed.inquiry_submit_selector).toBe(SQL_VALUE)`.
  Low severity (the cross-check is currently true in the ground-truth fixture), but the test
  misleads a future reader. → folded into FOLLOW-147 AC.
- **CB-2 (P2) — `pilot_inquiry_selector.test.ts:62` ("passes create_missing=true") asserts only
  `expect(sql).toContain('true')`.** The migration SQL contains the literal `'true'` in only the
  one `jsonb_set` argument today, but a future editor could add `WHERE ... AND active = true` (or
  any other `true` token) and the assertion would still pass even if `create_missing` was removed.
  A stricter assertion would match the full 4-arg `jsonb_set(...)` call signature ending in
  `, true)`. Low severity, but the test does not actually defend its stated invariant. → folded
  into FOLLOW-147 AC.

#### 4c. Test coverage gaps

- **TG-1 (P1) — no integration test exercises the migration against a real (or pgmem /
  Testcontainers) Postgres instance.** All 13 tests are string assertions on the SQL file; none
  actually run the migration against a database with a known pilot row and assert the JSONB key
  landed. The PR description explicitly defers the live-DB validation to manual
  `doppler run ... pnpm db:migrate` in staging + production. This is acceptable for THIS single
  migration (the SQL is short and reviewable), but it is the standing pattern in
  `packages/db/src/__tests__/` (all 5 test files — archetype_embeddings_seed, ab_bandit_weights,
  client, index, this — share the same approach), so every data-seed migration in this repo has
  zero CI-asserted runtime correctness. Specifically uncovered here: (a) what happens if `tenants`
  is empty (sub-query returns NULL → `WHERE tenant_id = NULL` → zero rows updated, silent no-op);
  (b) what happens if multiple rows match the slug (LIMIT 1 picks one, the others stay NULL);
  (c) what happens if the `schema` JSONB blob is `NULL` at the column level (vs. `{}` empty
  object) — `jsonb_set(NULL, ...)` returns NULL, so the row would update to NULL, but the WHERE
  guard would have already excluded it because `(NULL)->>'inquiry_submit_selector' IS NULL` is
  true, so it would be a no-op write of NULL → NULL. None of these branches are asserted by a
  test. → **FOLLOW-147 AC** (add a verification harness, not a full integration test).
- **TG-2 (P1) — no SDK→API→DB end-to-end test asserts the inquiry-observer wire activates for the
  pilot tenant after this migration applies.** The user explicitly asked the analyst to check
  this. The existing test coverage:
  - DB layer: this PR (structural only, no live DB).
  - Auto-detect producer layer:
    `packages/sdk/src/auto-detect/__tests__/detect-inquiry-selector.test.ts` (20 unit tests,
    synthetic HTML only — RETRO-021 §4c TG-1).
  - Observer consumer layer: `packages/sdk/src/__tests__/observer-inquiry.test.ts` (unit,
    in-memory DOM + injected config — does not load tenant schema from a DB).
  - E2E: `packages/sdk/e2e/inquiry-observer.spec.ts` (3 tests) loads
    `packages/sdk/e2e/fixtures/inquiry.html`, which **hardcodes**
    `data-inquiry-submit-selector="[data-estalara-slot='inquiry-submit']"` on the script tag
    (`inquiry.html:18`) — i.e., bypasses the DB lookup entirely; the E2E does not exercise the
    `/api/sdk/config` (or whichever endpoint serves the snippet's runtime config) path that the
    pilot site uses, and so does NOT regression-test the wire this migration is meant to power.
    Net: there is NO test, anywhere, that asserts "pilot tenant row's
    `schema->>'inquiry_submit_selector'` is read from the DB → served to the SDK config → wired
    into the Observer → fires `inquiry.started`". The pilot's headline conversion metric depends
    on this wire and it is verifiable only by manual smoke against staging/production. →
    **FOLLOW-147 AC** (the end-to-end staging smoke step is mandatory before the shadow→live
    flip).
- **TG-3 (P2) — no test asserts the migration is idempotent across multiple sequential runs (run
  twice → second run is no-op).** The PR description claims idempotency from the WHERE guard, but
  no test exercises it. The structural test asserts the *presence* of the guard string, not the
  *behavior*. → folded into FOLLOW-147 AC.

#### 4d. Documentation gaps

- **DG-1 (P1) — `docs/ops/PILOT_RUNBOOK.md` is NOT updated to document the new
  `doppler run --project estalara-adaptive-listings --config prd -- pnpm db:migrate` step in the
  activation procedure (§5).** The PR description includes the apply command as a "Test plan"
  checkbox, but §5 of PILOT_RUNBOOK is a `_Stub. To be authored by TICKET-PILOT-002_` and §3
  (Pre-live validation steps) does not mention the pilot-row-seeding pre-flight. The user
  explicitly asked this question. A go/no-go reviewer reading the runbook today will not see
  "verify `tenant_site_schemas.schema->>'inquiry_submit_selector'` is non-empty for the pilot
  tenant before declaring Section 1 row 4 (inquiry wire) green." This is exactly the documentation
  gap RETRO-021 §4d DG-1 flagged on the SDK-detection side; the migration-side equivalent is now
  equally relevant. → **FOLLOW-147 AC.** (Not a separate stub — the runbook step lives in the
  same operational PR as the apply-and-verify step.)
- **DG-2 (P2) — the migration file does not link to TICKET-PILOT-001's pilot-row activation
  step.** The SQL header reads "FOLLOW-141 — Seed inquiry_submit_selector on pilot tenant
  (idempotent)" but does not say "this migration MUST be applied before TICKET-PILOT-001's
  shadow→live flip." A future operator running migrations as a batch has no in-file reminder. →
  folded into FOLLOW-147 AC (PILOT_RUNBOOK is the canonical cross-reference home).
- **DG-3 (P2) — MASTER_DESIGN §B (auto-detection) still does not record the L1–L7 ladder + the
  probe-overrides-LLM precedence (RETRO-021 §4d DG-1 carry-forward), and AC3 of FOLLOW-141 is the
  ticket where it should have landed. This PR did not write that doc.** → **FOLLOW-148** (AC3
  carry-forward).

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13b Lane B, READY, QUEUE.md L2269–L2310) — its FOLLOW-141 dependency
  is PARTIALLY satisfied, not fully.** The ticket notes (QUEUE.md L2291–L2294) explicitly state
  "FOLLOW-141 must be verified during the shadow window (pairs with FOLLOW-092)." The
  shadow-window verification is now the actual gate: applying the migration to prod is necessary
  but not sufficient, because §3 / §4a LG-1 show the migration's effect is contingent on the
  pilot row's slug. **PM/architect must enforce:** the TICKET-PILOT-001 spawn checklist requires
  (a) pre-apply `SELECT slug FROM tenants WHERE id = '<DEMO_TENANT_ID>'` → confirm slug matches
  `'000-app-estalara'`, OR amend the migration; (b) post-apply
  `SELECT schema->>'inquiry_submit_selector' FROM tenant_site_schemas WHERE tenant_id = '<DEMO_TENANT_ID>'`
  → confirm the value is the canonical selector; (c) staging shadow-mode smoke confirming
  `inquiry.started` fires when the pilot site's submit button is clicked. Flagged here per
  constraint 3 for PM/architect attention; this is the headline pilot conversion metric.
- **FOLLOW-092 (verify cta.clicked producer→ClickHouse for pilot, BLOCKED, depends_on
  TICKET-PILOT-001) — directly downstream.** If §4a LG-1 lands silently (slug mismatch →
  migration no-op), FOLLOW-092 will measure zero inquiry.starteds during the shadow window —
  RETRO-021 §5b. Carry-forward unchanged: reconcile FOLLOW-147 before FOLLOW-092 spawns.
- **TICKET-PILOT-004 (`backlog/sprint-12/TICKET-PILOT-004.md`, references
  `inquiry_submit_selector`) — verify its assumptions still hold.** It is the other ticket in the
  repo that names the field; its AC 5 ("000-app-estalara fixture update") refers to the SDK
  *fixture*, not the DB row, so its scope is independent of this PR. No new dependency from this
  retro; carry-forward from RETRO-021.

#### 5b. Future sprint tickets affected

- **FOLLOW-147 (new, this retro, P0) — pilot-slug verification + post-apply assertion +
  PILOT_RUNBOOK apply-and-verify step + test-tautology fix.** Must close BEFORE TICKET-PILOT-001's
  shadow→live flip. The most important AC is a deterministic check (script, SQL assertion, or
  test) that fails fast if the pilot row's slug does not match the migration's WHERE clause
  assumption.
- **FOLLOW-148 (new, this retro, P1) — AC2 + AC3 of FOLLOW-141 carry-forward.** Corpus harness
  scoring of `finalSchema.inquiry_submit_selector` + a ≥1 real corpus site exercising L2–L7 + a
  probe-vs-AI-Vision precedence test + the L1–L7 ladder recorded in MASTER_DESIGN §B or a
  detection ADR. Sprint 13b or 14 (not a hard blocker on the pilot launch, but a hard blocker on
  the next platform onboarding).
- **YELLOW Sprint 2–4 reserved stubs FOLLOW-132..138 — N/A.** Neither follow-up is a YELLOW
  launch-readiness item.
- **Future migration authors (data-engineer, generally) — affected:** the pattern in this PR
  ("structural-only tests on a SQL file, no DB exercise") is the de-facto standard in
  `packages/db/src/__tests__/`. The next data-seed migration will inherit the same TG-1 gap. No
  separate stub filed — fixing the test pattern is out of scope for the pilot, but logged as a
  candidate Rule in §6 (single occurrence so far, below threshold).

#### 5c. Contracts changed that other modules rely on

- **N/A for breaking changes.** The Observer consumer (`packages/sdk/src/index.ts:381`) reads
  `inquirySubmitSelector` from `SdkConfig` and silently no-ops on undefined — this PR does not
  change the consumer contract; it changes the runtime data state of a single tenant row in a
  forward-additive way.
- **Behavioral contract risk (not type-level):** §3 HALF_WIRE_P / §4a LG-1 — the migration's
  contract with the Observer is "after migrate, the pilot row carries the selector." That
  contract is contingent on the slug invariant and there is no committed assertion of the
  invariant.

#### 5d. Architectural assumptions affected

- **Rule L lineage continuation (5th confirming instance, sub-axis: the "frozen pre-seeded row"
  gap remains open even after a migration is written).** RETRO-021 §6 noted a new sub-shape:
  "AC asserts a value was hand-set/seeded but the value lives only in a test fixture, not in a
  committed migration/seed" (count = 1, below threshold). RETRO-024 brings the count to **2** but
  for a slightly different shape: "a committed migration was written, but its WHERE clause
  invariant is unverified against the real production data state, so the migration's effect is
  contingent and silently no-ops on a mismatch." This is a related-but-distinct pattern; see §6.
- **Rule H ("Schema scaffold MUST ship with at least one runtime-wired consumer") — re-asserted
  on the data side.** Rule H originally covered TypeScript schema scaffolds. The data-migration
  analog is "a data-seed migration MUST ship with a verification step that confirms the seed
  landed on the real row, not just that the SQL file syntactically targets the row." Noted as
  evidence for a potential Rule H.1 / data-side companion clause; below promotion threshold.
- **Operational contract — "doppler run ... pnpm db:migrate is the canonical prod-apply command
  for schema/data migrations."** This is now an implicit assumption (PR description) without a
  runbook home. PILOT_RUNBOOK should canonicalize it (FOLLOW-147).

### 6. New lesson candidates

- **Pattern (Rule L lineage, new sub-shape) — "a committed migration's effect is contingent on a
  runtime invariant (e.g., a row's slug literal) that is NOT verified by any committed seed or
  assertion; the migration silently no-ops on a mismatch and `db:migrate` reports success."**
  - Seen: RETRO-024 (this retro, §3 / §4a LG-1).
  - Sibling shape (test-fixture-only provenance, RETRO-021 §6): seen RETRO-021. Count for the
    closely related "claimed seed has no committed authority" parent-pattern = **2** (RETRO-021 +
    RETRO-024), which crosses the promotion threshold IF treated as one pattern. Per the
    no-broaden-the-pattern discipline, I treat the two as distinct sub-shapes: RETRO-021 = "value
    lives only in a test fixture"; RETRO-024 = "migration's WHERE invariant is unverified". The
    parent pattern ("a 'seeded' pilot value lacks a committed verification path") has 2 instances
    and IS at the threshold. **Decision: NOT promoted in this retro, because (a) Rule L already
    covers the broader producer-consumer-wiring family and these are sub-axes inside Rule L's
    blast radius, and (b) the two instances differ in remediation (RETRO-021 → write a migration;
    RETRO-024 → write a verification harness around the migration), so the rule text would be
    too narrow to be actionable across both.** Instead, **flag as evidence for a future Rule L.1
    promotion when a third instance appears**, and require FOLLOW-147's verification harness as
    the concrete artifact that pre-empts the third instance.
- **Pattern — "a `packages/db/src/__tests__/*` test file asserts only the SQL file's *text* and
  never exercises the migration against a Postgres instance."** Seen: this PR + the four
  pre-existing files in `packages/db/src/__tests__/` (per `archetype_embeddings_seed.test.ts`,
  `ab_bandit_weights.test.ts`, etc., by pattern). Count of *retrospective findings* = 1
  (RETRO-024); count of *codebase instances* = 5. Below the retro-promotion threshold (2 distinct
  retros). Logged so the next data-engineer retro that touches `packages/db/src/__tests__/`
  crosses the threshold. Recommended remediation when promoted: `packages/db/src/__tests__/` MUST
  include a pgmem or Testcontainers harness for each data-seed migration (data-affecting
  migrations only; DDL-only migrations can stay structural).
- **Pattern (partial-AC pattern) — "a follow-up's PR closes only the first AC and does not file
  carry-forward stubs for the unfulfilled ACs in the PR body or QUEUE notes."** Seen RETRO-024
  (AC2 + AC3 unfulfilled, no carry-forward filed by worker). Count = 1. Below threshold. Noted —
  this is a process pattern (worker discipline), not a code pattern; consider for a CONTRIBUTING /
  worker-checklist update if it recurs.
- **No Rule promotion this retro.** All three patterns above are below threshold or already
  covered by Rule L's family.

### 7. Follow-ups

- **FOLLOW-147** (backend-engineer + data-engineer, 2.5h, **P0**, must close BEFORE
  TICKET-PILOT-001 shadow→live flip): make migration 0016's effect verifiable — (a) commit a
  pre-apply SELECT check that confirms the pilot row's slug actually matches `'000-app-estalara'`
  (or amend the migration to look up by `DEMO_TENANT_ID` env var / a different invariant); (b)
  add a post-apply assertion (script or test) that confirms
  `tenant_site_schemas.schema->>'inquiry_submit_selector'` is the canonical selector for the
  pilot row after `db:migrate`; (c) update `docs/ops/PILOT_RUNBOOK.md` §3 (Pre-live validation)
  and §5 (Activation procedure stub) to document the apply-and-verify step
  `doppler run --project estalara-adaptive-listings --config prd -- pnpm db:migrate` + the SELECT
  verification; (d) fix the tautological cross-check test
  (`pilot_inquiry_selector.test.ts:74`) to read the fixture file and compare to the SQL value;
  (e) tighten the `create_missing=true` test (`:62`) to match the full `jsonb_set(...)`
  signature. Closes §3 HALF_WIRE_P, §4a LG-1, §4b CB-1/CB-2, §4c TG-1/TG-2/TG-3, §4d DG-1/DG-2.
  (`source_retro: RETRO-024`, `depends_on: FOLLOW-141`.)
- **FOLLOW-148** (ml-engineer + architect, 4h, **P1**, Sprint 13b or 14 — pre-second-platform
  onboarding): close FOLLOW-141 AC2 + AC3 — (a) extend the auto-detect corpus harness
  (`packages/sdk/src/auto-detect/test-utils.ts:550-568`) to score top-level fields including
  `finalSchema.inquiry_submit_selector` against ground truth; (b) add ≥1 real or synthetic corpus
  site beyond `000-app-estalara` that exercises the L2–L7 probe path (not just the L1
  `data-estalara-slot` marker); (c) add a unit test in
  `packages/sdk/src/auto-detect/__tests__/detect-inquiry-selector.test.ts` asserting probe-vs-LLM
  precedence on conflict (probe wins when both return non-empty); (d) record the L1–L7 heuristic
  ladder + the probe/LLM precedence rule in MASTER_DESIGN §B (auto-detection) or a new
  `docs/adr/ADR-NNNN-inquiry-selector-detection-ladder.md`. Closes §4a LG-2, §4c (general
  measurement gap), §4d DG-3, and the FOLLOW-141 AC2 + AC3 carry-forward.
  (`source_retro: RETRO-024`, `depends_on: FOLLOW-141`.)
- **Carry-forward note (no new stub):** RETRO-021 already filed FOLLOW-141 to cover all three
  ACs. This retro's discovery is that AC1 itself remains contingent (FOLLOW-147) and AC2/AC3 were
  not attempted in this PR (FOLLOW-148). The status of FOLLOW-141 in `backlog/FOLLOW_UPS.md`
  should be changed from "DONE — PR #165 open" to "PARTIAL — PR #165 closes AC1 contingently;
  AC2 + AC3 outstanding (FOLLOW-148); AC1 verification outstanding (FOLLOW-147)" — PM action,
  not this agent's edit (RETRO-analyst is append-only on RETROSPECTIVES.md, FOLLOW_UPS.md,
  CONVENTIONS_PATCH.md).
- **Wave roll-up (second and final retro of Sprint 13a-hardening-v2):** the two-retro wave
  (RETRO-023..024) closed the P0 carry-forward from Sprint 13a-hardening and produced FOLLOW-143
  + FOLLOW-144 + FOLLOW-145 + FOLLOW-146 (RETRO-023, §13.2 localStorage residuals) and
  FOLLOW-147 + FOLLOW-148 (RETRO-024, pilot-slug verification + AC2/AC3 carry-forward). Net
  pre-pilot blockers for PM triage: **FOLLOW-147 is the lone P0** (must close before TICKET-PILOT-001
  shadow→live); RETRO-023's FOLLOW-143 is also P0 (wire `getOrCreateCrossSessionId` into init —
  EU compliance blocker); the rest are P1/P2.

### 8. Cross-references

- **RETRO-021 (FOLLOW-127, PR #161)** — direct parent retro: raised HALF_WIRE_C (P0) on the
  pilot row's `inquiry_submit_selector`. FOLLOW-141 (this PR's source ticket) is the stub
  RETRO-021 generated. This retro is the partial-close audit.
- **RETRO-017 (FOLLOW-114, PR #157)** — grandparent: raised the consumer-with-no-producer gap
  that RETRO-021 narrowed to the pilot row. The full lineage RETRO-017 → RETRO-021 → RETRO-024
  traces a single wire from general consumer → general producer → frozen-pilot-row producer →
  pilot-row-producer-with-verifiable-effect (FOLLOW-147).
- **RETRO-023 (FOLLOW-139, PR #164)** — sibling first-of-the-pair retro for
  Sprint 13a-hardening-v2. Both retros confirm the Rule L family (RETRO-023 = compliance
  consumer-with-no-producer; RETRO-024 = data producer-with-unverified-invariant) but on
  different sub-axes. The wave roll-up (§7) tracks the combined blocker set.
- **Rule L (CONVENTIONS_PATCH.md §L)** — already promoted; this retro is a fifth confirming
  instance on a new sub-axis (migration WHERE clause invariant unverified). **NOT re-promoted**
  per the no-double-promotion discipline.
- **Rule H (CONVENTIONS_PATCH.md §H)** — schema scaffold without a runtime-wired consumer. This
  retro extends the spirit of Rule H to data migrations (a data-seed without a verification
  harness is the data-side analog of a schema scaffold without a consumer). Logged as evidence;
  no promotion of a Rule H.1 today (single occurrence; threshold = 2).
- **PILOT_FREEZE_RULE.md (§Decision 2)** — pilot tenant = `DEMO_TENANT_ID` (env var UUID). The
  migration's slug-based identification is **not** the canonical pilot identifier per this design
  doc. FOLLOW-147 AC may resolve this by switching the migration to look up by `DEMO_TENANT_ID`
  or by adding a pre-apply check that the slug matches.
- **SECOND and FINAL of Sprint 13a-hardening-v2 retros** — siblings: RETRO-023 (#164 /
  FOLLOW-139). Wave complete; P0 carry-forward FOLLOW numbers are FOLLOW-143 (RETRO-023, wire
  xid into init) and FOLLOW-147 (this retro, pilot-slug verification).

---

## RETRO-025 — FOLLOW-143 + FOLLOW-144 inline fixes inside PR #164 (verification of the verification) — 2026-05-28

### 1. Summary of change

- **PR:** #164 (merged 2026-05-28 16:44:56 UTC, commit `e4e37ac`). RETRO-025 scope is the **two
  inline follow-up fixes** that were squashed into PR #164 *before* it merged:
  - **FOLLOW-143 inline fix** (P1, sdk-engineer, second commit on the PR) — wire
    `getOrCreateCrossSessionId()` into the SDK's `init()` flow so the disclosed `__estalara_xid__`
    localStorage entry actually appears in real browsers. RETRO-023 §3 CHECK A / HALF_WIRE_P /
    §4a LG-2 found this producer was dead-code at the initial commit; this fix wires it.
  - **FOLLOW-144 inline fix** (P0, sdk-engineer + compliance-engineer, second + third commits on
    the PR) — reconcile the "rotates monthly" / "every 30 days" disclosure across the consent
    banner (3 locales), DPIA §13.2 mitigations paragraph, and Privacy Notice §3 with the actual
    90-day TTL implementation; update the `consent-banner.test.ts` regex that pinned `/monthly/i`.
    RETRO-023 §3 HALF_WIRE_C / §4a LG-1 / §4d DG-1/DG-2/DG-3 found this cadence-mismatch on five
    surfaces; this fix takes path (b) — correct all five surfaces to "every 90 days" rather than
    implement a 30-day rotation step.
- **Both follow-ups marked DONE** in `backlog/FOLLOW_UPS.md:3864` (FOLLOW-143) and `:3916`
  (FOLLOW-144) on 2026-05-28. RETRO-025's job is to verify the inline fixes actually deliver what
  they claim — the §13.2 DPIA balancing-test flip to **unconditionally GREEN** in PR #164 rests
  entirely on these two fixes being correct.
- **Files changed in the two follow-up commits** (subset of the seven-file PR; the first commit
  was the FOLLOW-139 base implementation already covered by RETRO-023):
  - `packages/sdk/src/index.ts` (+16 / −0 across whole PR, all 16 from FOLLOW-143 commit) — adds
    `getOrCreateCrossSessionId` to the import list (`index.ts:21`); calls
    `void getOrCreateCrossSessionId()` in the `onGranted` banner callback (`index.ts:116`); calls
    `void getOrCreateCrossSessionId()` on init for returning granted visitors (`index.ts:158-160`).
    The `eraseCrossSessionId()` calls on the deny paths (`index.ts:95,128`) are unchanged from the
    FOLLOW-139 base commit.
  - `packages/sdk/src/ui/consent-banner.ts` (+7 / −7) — EN `:146` "rotates monthly" →
    "is refreshed every 90 days"; PL `:158` "jest rotowany co miesiąc" → "jest odświeżany co 90
    dni"; ES `:170` "rota mensualmente" → "se renueva cada 90 días"; matching JSDoc comments at
    `:135`, `:144`, `:156`, `:168` updated.
  - `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` (+3 / −3) — `:79-81` "rotates automatically every
    30 days" → "is refreshed every 90 days".
  - `docs/compliance/dpia.md` (+33 / −22) — §13.2 mitigations `:1039` "rotates every 30 days
    (limiting staleness)" → "is refreshed every 90 days (limiting staleness)"; the disclosed
    banner-copy quote later in §13.2 updated to match; balancing test status flipped from
    "GREEN — contingent on FOLLOW-128 deployment" to "GREEN — unconditionally passed as of
    FOLLOW-139" with the implementation evidence (`getOrCreateCrossSessionId()` call site in
    `index.ts`) cited inline; staging-QA gate updated to "READY FOR STAGING VERIFICATION" with the
    correct key name (`__estalara_xid__`) threaded in; new dated footer 2026-05-28 (FOLLOW-139).
  - `packages/sdk/src/__tests__/consent-banner.test.ts` (+6 / −6) — EN regex `/monthly/i` →
    `/refreshed every 90 days/i` (`:513`); PL regex `/miesi/i` → `/odświeżany co 90 dni/i` (`:532`);
    ES regex `/mensual/i` → `/renueva cada 90 d/i` (`:551`).
- **Modules touched (by the inline fixes only):** SDK UI + SDK init + SDK tests + compliance docs.
  No new tests added in the two follow-up commits (the test changes are pure regex updates to
  keep the existing test green after wording flip). No new ingest / decision-api / data-engineering
  / db-migration / config surface touched.
- **Key contracts changed (by the inline fixes only):**
  - `index.ts` consumer wiring of `getOrCreateCrossSessionId` (additive at call sites; producer
    surface was already exported in the FOLLOW-139 base commit). Breaking: **no**.
  - Disclosure-string contract on the §13.2 banner copy — EN/PL/ES rotation-cadence sentence
    changed from "monthly" to "every 90 days" (data-subject-facing contract; matches code).
  - DPIA §13.2 balancing-test status contract — "CONDITIONAL" → "UNCONDITIONAL GREEN" (compliance
    contract; the legal/DPO gate that the rest of the EU pilot launch chains off).
- **Verdict (preview):** **FOLLOW-UPS-FILED** (not CLEAN). The two inline fixes do most of what
  they claimed, BUT FOLLOW-143 AC1's mandatory integration test ("integration-level (jsdom or E2E)
  test asserts the key IS present in `localStorage` after a granted init AND ABSENT after a
  denied init — both halves of the wire") was **not added** — the only test coverage of the new
  init wiring is at the unit level of the producer itself. AND a residual cadence-disclosure
  inconsistency remains in `dpia.md:1017` ("30-day rotation bucket") that was NOT swept by the
  five-surface reconciliation (this sentence describes the LEGACY HMAC fingerprint inside §13.2,
  creating a dual-id/dual-cadence narrative inconsistency within the same DPIA section). One new
  stub filed: **FOLLOW-150** (P1, scoped to close FOLLOW-143 AC1 + the §13.2 residual sentence).

### 2. Verification done in PR

- **Test files changed (inline fixes only):** `consent-banner.test.ts` (regex updates only —
  6 lines edited, 0 new tests). No new file added. No new test added to `session.test.ts`. No
  new test added to `index.ts`'s test coverage chain (there is no `index.test.ts` in the SDK at
  all — the SDK's `init()` is exercised only by Playwright E2E tests in `packages/sdk/e2e/`).
- **Assertions added:** **0 new assertions** (the 6 regex edits are 1-to-1 replacements). The 6
  new unit tests in `session.test.ts:76-156` from the FOLLOW-139 base commit (covered by RETRO-023
  §2) still pass after the rewording but do **not** exercise the new init-path wiring — they call
  the producer directly from the test file. PR body cites "All 39 tests in `consent-banner.test.ts`
  and `session.test.ts` pass" after the wording flip.
- **CI checks (per PM instruction 2026-05-28):** treated as merged; the standing CI-gate caveat
  applies (Rule I / Vercel / Python lanes pre-existing-red & non-blocking, per the
  `project_ci_gate_landscape` memory).
- **AC verdict per follow-up:**
  - **FOLLOW-143 — PARTIAL.** AC1 producer-wired ✅, deny-path eraser still wired (unchanged from
    base) ✅, BUT AC1's mandatory integration test (KEY-PRESENT after grant AND KEY-ABSENT after
    deny) **NOT added** — see §3 CHECK B and §4c TG-1. AC2 (early-exit-deny coverage) NOT added.
    AC3 (legacy `__estalara_session__` erasure decision) not addressed by this PR. AC4 (Master
    Design / `session.ts` docblock dual-id model) not addressed (`session.ts` got only a 4-line
    addendum docblock at `:7-10`; the file-level docblock still frames SHA-256 fingerprint as the
    canonical session id; Master Design unchanged). AC5 (PILOT_RUNBOOK gate tightening) not
    addressed.
  - **FOLLOW-144 — SUBSTANTIALLY DONE (PARTIAL on AC1 path-(b) acceptance).** AC1 chose path (b)
    (correct disclosures rather than implement 30-day rotation). AC2 atomic update of all FIVE
    surfaces — **4 of 5 swept**: banner copy ×3 locales ✅, Privacy Notice §3 ✅, DPIA §13.2
    mitigations line 1039 ✅. **MISSED: `dpia.md:1017` still says "30-day rotation bucket"** in
    the §13.2 processing-activity paragraph — see §4d DG-1. AC3 path-(b) sibling
    (dual-id model reflected) carries forward from FOLLOW-143 AC4 (not done). AC4 (balancing-test
    re-evaluation without "rotates every 30 days" mitigation) was performed in the PR — the
    mitigation sentence at `dpia.md:1039` was rewritten to "is refreshed every 90 days (limiting
    staleness)" and the balancing test was re-justified on the basis of refreshed cadence rather
    than the deleted 30-day rotation. AC2's `consent-banner.test.ts` regex update was performed.
- **Rule N + Rule N amendment verdict (key central caveat):** the Rule N amendment promoted by
  RETRO-023 (`CONVENTIONS_PATCH.md:550-588`) prescribes a 4-step cadence-check verification —
  grep cadence claims in EVERY disclosure surface, grep `TTL_MS`/`day_bucket`/`ROTATION_INTERVAL`
  constants in code, compare, reconcile any pinning test regex. Applying that grep to the
  post-merge tree (Step 2: `grep -rn "rotate\|every 30\|every 7\|every 24\|monthly\|weekly\|daily\|hourly" packages/sdk/src/ui/consent-banner.ts docs/compliance/dpia.md docs/compliance/PRIVACY_NOTICE_TEMPLATE.md`)
  returns **one residual hit:** `docs/compliance/dpia.md:1017` "30-day rotation bucket". This is
  the SAME §13.2 section in which `dpia.md:1039` was reconciled — so the cadence-mismatch sub-shape
  Rule N amendment was meant to prevent is recurrent within ONE document within ONE day-cycle of
  the amendment's promotion. The recurrence is on a related-but-different identifier (the legacy
  HMAC fingerprint, not the new UUID xid) but it lands in the SAME §13.2 narrative the LIA flip
  rests on — a reader of §13.2 cannot tell which `localStorage` identifier is being described or
  which rotation cadence applies. The Rule N amendment caught the cadence-WORDING (which was
  fixed for 4 of 5 surfaces) but did not yet enumerate the **dual-id-narrative-collision**
  failure shape (one DPIA section describing two distinct identifiers both stored in
  `localStorage` with different cadences). See §6.

### 3. Wiring Audit

**CHECK A — Dead code detection (inline-fix-introduced symbols only):**

- The two follow-up commits added no new exports. `index.ts` imports
  `getOrCreateCrossSessionId` from `core/session.js` (`:21`) and calls it twice
  (`:116`, `:159`). Both call sites are real production paths reached on init (returning granted
  visitor) and on the `onGranted` banner callback. The previously-dead-code symbol from RETRO-023
  is now LIVE.
- `eraseCrossSessionId` continues to be called at `:95` and `:128` (unchanged from FOLLOW-139
  base). With the producer now actually creating the key, the eraser is now erasing something
  real — i.e. RETRO-023 §3 CHECK A DEAD_CODE on `getOrCreateCrossSessionId` is **CLOSED**.
- Grep `getOrCreateCrossSessionId` across `packages/` and `apps/` excluding `node_modules` /
  `.next` / `__tests__` / `.test.ts` / `.spec.ts` returns **4 non-test hits**, all inside
  `packages/sdk/src/index.ts` (the import + 2 call sites at `:116`, `:159`) and the producer
  definition at `packages/sdk/src/core/session.ts:177`. Non-test importers ≥ 1. **Not dead.**
- No other new files. **CHECK A clean ✅.**

**CHECK B — Half-wire detection (key claims by the two inline fixes):**

- **`sdk-symbol:getOrCreateCrossSessionId` (RETRO-023 HALF_WIRE_P remediation).**
  - **Producer (call-site / wire-level) — NOW EXISTS ✅.** `index.ts:116` (in
    `onGranted` callback) + `index.ts:159` (returning granted visitor on init). Both run before
    any event flush (`:159` is at the top of the granted-path block, before `getOrCreateSession()`
    at `:164` per the inline comment "Must run before session init so the key is populated before
    any events fire"). The fix correctly threads the producer into the post-consent init path.
  - **Consumer (data subject, DPO, §13.2 disclosure) — EXISTS ✅.** The disclosed
    `__estalara_xid__` key now actually appears in real browsers; the eraser-on-deny path now
    erases a key that actually existed.
  - **Test-level wire — STILL HALF.** No integration/E2E test invokes `init()` and asserts
    `localStorage[__estalara_xid__]` is set after a granted run AND absent after a denied run.
    The 6 new unit tests added in PR #164 call the producer directly from the test file (the
    integration-shape test at `session.test.ts:146-154` is named "eraseCrossSessionId called on
    consent denied path (integration with index.ts wiring)" but is actually a pure unit test that
    simulates the call sequence in the test — it does NOT execute `init()` from `index.ts`).
    `packages/sdk/e2e/consent.spec.ts` exercises Accept and Decline buttons end-to-end against a
    Playwright fixture but only asserts the `estalara_consent` key state (`:90-95`, `:148-150`),
    **never asserts `__estalara_xid__`**. So the wire is now **producer-side-correct in code**
    but **untested at the integration level** — meaning a future revert that drops one of the two
    `void getOrCreateCrossSessionId()` calls from `index.ts` would NOT be caught by any test. This
    is the precise gap FOLLOW-143 AC1 demands close. Priority **P1** (a future regression here
    silently reverts the §13.2 LIA evidence the DPO sign-off rests on). → **FOLLOW-150** AC1.
  - Producer code-side: **HALF_WIRE_P closed** ✅. Test-side wire: **HALF_WIRE_T (test-coverage
    half-wire) — open** ⚠.
- **`disclosure-claim:rotation-cadence` (RETRO-023 HALF_WIRE_C remediation).**
  - **Producer (code) — UNCHANGED ✅.** `core/session.ts:130-225` still performs single-step
    90-day TTL replacement. `XID_TTL_MS = 90 * 24 * 60 * 60 * 1000`. No 30-day step.
  - **Consumer (5 disclosure surfaces) — 4 of 5 reconciled ✅, 1 of 5 RESIDUAL ⚠.** Grep
    `monthly\|every 30 days\|30-day\|every month` across the five §13.2 disclosure surfaces (3
    banner locales + DPIA §13.2 + Privacy Notice §3) returns **one hit**:
    `docs/compliance/dpia.md:1017` "keyed by `tenant_secret` and a 30-day rotation bucket. The
    hash is stored in `localStorage` and transmitted with every ingest event." This sentence is
    in the §13.2 **Processing activity** paragraph describing the **legacy HMAC fingerprint**
    (canvas + AudioContext + screen entropy keyed by `tenant_secret`) — NOT the new UUID xid
    introduced by FOLLOW-139. But §13.2 now contains two parallel claims about a
    `localStorage`-stored cross-session identifier with two different cadences (30-day rotation
    bucket for the legacy HMAC, refreshed-every-90-days for the new UUID xid). The dual-id
    collision is internal to §13.2 and would mislead any reader (DPO, auditor, future
    sdk-engineer) about which identifier and which cadence the §13.2 LIA balancing test rests
    on. The Rule N amendment (Step 1 grep) would catch this on a careful sweep but only flags
    it as "cadence claim present" — it would not surface the dual-id-narrative ambiguity. The
    fix is to either (a) split §13.2 into two sub-sections (one per identifier) or (b) update
    the processing-activity paragraph to acknowledge BOTH identifiers with their respective
    storage keys (`__estalara_session__` for the legacy HMAC; `__estalara_xid__` for the new
    UUID) and TTLs. Priority **P1** → **FOLLOW-150** AC2. The blast radius is doc-only (no code
    change), but the DPO gate at `dpia.md:1078` reads §13.2 to sign off, and an internally
    self-contradictory §13.2 puts the DPO sign-off at risk.
  - Code-side: **HALF_WIRE_C closed for 4 of 5 surfaces** ✅. Doc-side §13.2 residual:
    **HALF_WIRE_C — open on 1 of 5 surfaces** ⚠ (dual-id narrative within the same DPIA section).
- **No new env var, DB column, Redpanda topic, or wire event introduced by the inline fixes.**
  The xid still does NOT travel on event payloads — that work is correctly carved out as
  FOLLOW-146 (re-verified in §5b — FOLLOW-146 status: OPEN in `backlog/FOLLOW_UPS.md:4006`, no
  accidental scope creep into PR #164). **Clean carve-out ✅.**

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P1) — FOLLOW-143 AC1 integration test is not implemented.** The producer is wired in
  code (`index.ts:116,159`) but no test exercises `init()` and asserts the localStorage state
  after init. AC1 explicitly requires "An integration-level test (jsdom or E2E) asserts the key
  IS present in `localStorage` after a granted init AND ABSENT after a denied init — both halves
  of the wire". The PR added 0 such tests. Without it, a future revert that drops either
  `void getOrCreateCrossSessionId()` call would re-introduce RETRO-023's
  producer-never-invoked failure with zero CI signal. → **FOLLOW-150 AC1**.
- **LG-2 (P2) — `consent-banner.test.ts:385` test-file comment still says "monthly rotation".**
  This is a **pure comment** (`// §13.2 key facts: cross-session pseudonymous identifier, 90-day
  retention, monthly rotation.`), zero behavioral impact, but it directly contradicts the test
  assertions five lines below it (`.toMatch(/refreshed every 90 days/i)`). A future reader of the
  test file gets conflicting framing. → folded into FOLLOW-150 AC3 (sweep comment).

#### 4b. Code bugs not caught

- N/A. The inline fixes are line-by-line text substitutions on copy strings + two
  `void getOrCreateCrossSessionId()` insertions on existing branches. No new runtime logic was
  introduced by the inline fixes themselves. (RETRO-023 §4b CB-1/CB-2/CB-3 carry forward
  unchanged — those are bugs on the underlying FOLLOW-139 implementation, not on the inline
  fixes.)

#### 4c. Test coverage gaps

- **TG-1 (P1) — no integration / E2E test for the init-path xid wiring.** Same gap as LG-1,
  expressed from the test-coverage angle. The only coverage of the new init wiring is the unit
  tests that call the producer directly. `packages/sdk/e2e/consent.spec.ts` exercises the Accept
  and Decline buttons end-to-end but does not query `localStorage[__estalara_xid__]` — extending
  it by ~6 lines would close the gap (after the Accept assertion at `:95` add
  `expect(await page.evaluate(() => localStorage.getItem('__estalara_xid__'))).not.toBeNull()`;
  symmetric assertion `.toBeNull()` after the Decline assertion at `:148`). → **FOLLOW-150 AC1**.
- **TG-2 (P2) — no test asserts the inline-fix wording IS the rendered banner text in a real
  browser.** The unit-test regex updates (`/refreshed every 90 days/i`, `/odświeżany co 90 dni/i`,
  `/renueva cada 90 d/i`) verify the COPY constant; they do not verify the rendered Shadow DOM
  carries that text. `consent.spec.ts` does not assert §13.2 banner text presence end-to-end.
  Low severity (the Shadow DOM render is already exercised by the consent-banner unit suite at
  the JSDOM level), but documented for future hardening. Not folded into a stub.

#### 4d. Documentation gaps

- **DG-1 (P1) — `dpia.md:1017` residual "30-day rotation bucket" sentence inside §13.2.** Details
  in §3 CHECK B HALF_WIRE_C residual. The §13.2 **Processing activity** paragraph describes the
  legacy HMAC fingerprint as "stored in `localStorage`" and rotating on a "30-day rotation bucket"
  — same section, same physical storage tier, different identifier and different cadence than
  the new UUID xid that the rest of §13.2 (line 1039 onwards) now describes as
  "refreshed every 90 days". A reader cannot determine which `localStorage` identifier and which
  cadence the §13.2 LIA balancing test rests on. Either (a) split §13.2 to describe both
  identifiers separately with their respective storage keys (`__estalara_session__` and
  `__estalara_xid__`) and TTLs, OR (b) clarify in the Processing-activity paragraph that the
  "30-day rotation bucket" applies to the HMAC's `day_bucket` salt input (per Master Design
  §B / `session.ts:1-12` legacy docblock) while the persisted `localStorage` lifetime is
  governed by the new xid's 90-day TTL — naming the keys distinctly. The DPO sign-off (gate at
  `dpia.md:1078`) is the immediate consumer. → **FOLLOW-150 AC2**.
- **DG-2 (P2) — RETRO-023 §4d DG-4 (Master Design dual-id model) and FOLLOW-143 AC4 (the
  `session.ts` file-level docblock) are NOT addressed by PR #164.** The inline fixes did not
  update Master Design §B / §Snapshot.1; did not extend the `session.ts:1-12` file-level
  docblock beyond the 4-line `:7-10` addendum (FOLLOW-139 base commit, not the inline fixes).
  FOLLOW-143 remains marked DONE in `FOLLOW_UPS.md:3864` but AC4 is unfulfilled. This is
  per-FOLLOW status drift (AC4 was not addressed even though FOLLOW-143 is marked DONE);
  remediation can be folded into FOLLOW-150 OR re-opened on FOLLOW-143 itself by PM. →
  **FOLLOW-150 AC4** (or PM may choose to re-open FOLLOW-143 instead — flagged below in §7).

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13b Lane B, READY) — §13.2 EU go-live gate status.** RETRO-023 §5a
  flagged that PR #164's GREEN flip was premature; the inline fixes in this same PR now address
  the two primary P0/P1 gaps RETRO-023 surfaced. **Net result: the §13.2 balancing-test GREEN
  flip is now substantially supportable** (the disclosed-cadence claims match the code's actual
  90-day TTL; the producer actually fires from init paths; the eraser actually erases a key that
  exists). The one residual cadence sentence at `dpia.md:1017` (legacy HMAC, dual-id collision)
  is an internal §13.2 inconsistency, not a code-vs-doc HALF_WIRE_C of the same blast radius as
  RETRO-023's findings; the DPO sign-off can probably proceed if the §13.2 narrative is tightened
  before sign-off (FOLLOW-150 AC2). **P0 EU pilot launch is NOT blocked by RETRO-025 findings;
  the residuals are P1.** PM action: file FOLLOW-150 and either (a) require it close before DPO
  sign-off, or (b) include the §13.2 narrative tightening in the DPO presentation deck so DPO
  can sign off with full context. **The PR-level inline-fix discipline (squash both follow-ups
  into the same PR rather than open new PRs) was sound — it kept the §13.2 closure atomic.**
- **TICKET-PILOT-002 (go/no-go runbook, BLOCKED) — unchanged from RETRO-023 §5a.** FOLLOW-143
  AC5 (PILOT_RUNBOOK EU pre-flight gate tightening to assert both KEY-PRESENT and KEY-ABSENT) is
  STILL unfulfilled by the inline fix. RETRO-023's recommendation that the runbook tester observe
  KEY-PRESENT after grant AND KEY-ABSENT after deny remains the right gate; the runbook does not
  yet carry this. → folded into FOLLOW-150 AC1 (the integration test is the canonical artifact
  the runbook should reference) or stays on FOLLOW-143 if PM re-opens it.
- **FOLLOW-141 (PR #165) — sibling-but-unrelated; no impact.**
- **FOLLOW-147 (still P0 OPEN, pilot-slug verification, from RETRO-024) — unrelated; no impact.**

#### 5b. Future sprint tickets affected

- **FOLLOW-146 (xid on event wire / ingest join key, status: OPEN per `FOLLOW_UPS.md:4006`) —
  unchanged.** PR #164's inline fix correctly DID NOT scope-creep into FOLLOW-146 territory; the
  inline FOLLOW-143 fix carries explicit comments at `index.ts:115` and `index.ts:157` noting
  that "FOLLOW-146 will attach xid to event payloads" — the carve-out is clean. Verified by
  grepping `x_session_id`/`xSessionId` across all packages/apps: **zero hits**, meaning the xid
  is still a stand-alone client-side artifact and does not yet flow on the wire. FOLLOW-146
  remains the ticket that delivers cross-session continuity end-to-end. No new dependency from
  this retro.
- **FOLLOW-145 (Withdraw button, P2, OPEN) — unchanged.**

#### 5c. Contracts changed that other modules rely on

- **§13.2 disclosure-cadence contract — 4 of 5 surfaces synchronized at "every 90 days".** Any
  tenant who publishes the Estalara-supplied Privacy Notice template (per
  `PRIVACY_NOTICE_TEMPLATE.md:79`) now ships an accurate cadence claim. Any control-plane
  template-render or auto-onboarding wizard that re-uses the §13.2 banner copy will get the
  updated wording. No downstream consumer needs to change behavior — the contract change is
  documentation-favorable (factual correctness).
- **§13.2 balancing-test contract — UNCONDITIONAL GREEN.** Downstream DPO sign-off can now
  proceed without a FOLLOW-128/FOLLOW-139 contingency. Caveat: the §13.2 narrative inconsistency
  (DG-1) should be tightened before the DPO presentation to avoid a back-and-forth on which
  identifier and cadence the LIA is conditioned on.

#### 5d. Architectural assumptions affected

- **Rule N lineage — fifth instance, third sub-axis (dual-id-narrative collision).** Pattern N
  (compliance doc asserts behavior the code does not implement) now has five consecutive
  occurrences across RETRO-018, RETRO-019, RETRO-020, RETRO-023, and **RETRO-025**. The first
  four sub-axes were: (1) string absent from banner, (2) behavior absent from code, (3) retention
  claim unenforced, (4) cadence claim diverges from TTL. **RETRO-025's new sub-axis is (5)
  dual-id narrative collision within ONE compliance section** — one DPIA paragraph names two
  parallel `localStorage` identifiers with two different cadences without disambiguating which
  identifier and which cadence the LIA conditions on. The remediation pattern is DIFFERENT from
  the prior four: this is not a wording fix or a code fix; it is a narrative restructuring (split
  §13.2 by identifier OR clarify the storage-key-to-cadence mapping inline). The Rule N parent
  shape ("compliance doc asserts behavior the code does not implement") still describes the root
  problem but the verification grep added by the 2026-05-28 amendment (cadence-claim sweep)
  catches the SYMPTOM (one grep hit) without surfacing the deeper shape (two identifiers
  conflated in one paragraph). See §6 for the candidate sub-amendment.
- **Dual-id model documentation debt (continuation of RETRO-023 §5d).** RETRO-023 flagged that
  Master Design + `session.ts` file-level docblock do not acknowledge the dual-id model. PR #164
  did not address this (FOLLOW-143 AC4 unfulfilled). The §13.2 internal inconsistency
  (DG-1 / FOLLOW-150 AC2) is the in-the-wild manifestation of that documentation debt — without
  a documented dual-id model, a doc author updating §13.2 would not know there were two
  identifiers to disambiguate. → reinforces FOLLOW-150 AC4 (extend `session.ts` file-level
  docblock + Master Design §B to make the dual-id model explicit).

### 6. New lesson candidates

- **Pattern N (compliance doc asserts behavior the code does not implement) — FIFTH consecutive
  occurrence, third sub-axis (dual-id-narrative collision within ONE compliance section).**
  Per the no-double-promotion discipline (Rule N already promoted by RETRO-019; amendment
  promoted by RETRO-023), **Rule N is NOT re-promoted.** This retro is a fifth confirming
  instance. The new sub-axis (dual-id narrative collision) is NOT yet covered by either the
  original Rule N verification block (presence/absence of producers and removeItem calls) or by
  the RETRO-023 cadence-mismatch amendment (which catches the symptom — a residual cadence
  string — but not the deeper shape — two identifiers conflated in one paragraph). Count of the
  dual-id-narrative-collision sub-shape = **1** (this retro). Below the dedicated promotion
  threshold of 2 for a standalone rule or amendment. **NOT promoted in this retro.** Logged as
  evidence so a future second occurrence (e.g., another compliance section conflating two
  storage tiers or two retention policies for a single named user-facing concept) crosses the
  threshold. Recommended amendment text if/when promoted: extend Rule N Step 1 grep to flag
  any compliance section that mentions a `localStorage`/`sessionStorage`/`Cookie` storage tier
  more than once with different cadences — and require each such mention to name the specific
  storage key it refers to.
- **Pattern (FOLLOW-status drift — a FOLLOW-UP marked DONE without all ACs fulfilled).** This
  retro found FOLLOW-143 marked DONE in `FOLLOW_UPS.md:3864` despite AC1's integration test (LG-1),
  AC2's early-exit-deny test (RETRO-023 §4c TG-3 carry-forward), AC3 (legacy-fingerprint erasure
  decision), AC4 (docblock + Master Design dual-id), AC5 (PILOT_RUNBOOK gate) all being
  unfulfilled by the inline fix. The PR-level intent was reasonable (squash the P0/P1 code fixes
  into the same PR to keep §13.2 closure atomic) but the FOLLOW-status accounting overreached —
  AC1 was partially addressed (producer wired) but the AC1 sentence "An integration-level test
  asserts the key IS present after grant AND ABSENT after deny" was not. This is a process
  pattern, not a code pattern. Seen: **1 retro** (RETRO-025). Below the promotion threshold of 2.
  Logged for a future second occurrence; consider a CONTRIBUTING / worker-checklist update if it
  recurs ("a FOLLOW-UP must not be marked DONE unless every AC checkbox is closed by a
  committed artifact — partial-AC closure requires a carry-forward stub").
- **No Rule promotion this retro.** Both patterns above are below threshold or already covered
  by Rule N's family.

### 7. Follow-ups

- **FOLLOW-150** (sdk-engineer + compliance-engineer, 2h, **P1**, before EU pilot DPO sign-off):
  Close FOLLOW-143's missing integration test + reconcile the §13.2 dual-id-narrative residual +
  sweep the stale `consent-banner.test.ts:385` comment + finally address FOLLOW-143 AC4 (the
  `session.ts` file-level docblock + Master Design §B dual-id model). Closes §3 CHECK B
  HALF_WIRE_T + §3 CHECK B HALF_WIRE_C-residual + §4a LG-1/LG-2 + §4c TG-1 + §4d DG-1/DG-2 + §5a
  TICKET-PILOT-002 runbook gate + §5d dual-id-model documentation debt.
  (`source_retro: RETRO-025`, `depends_on: FOLLOW-139, FOLLOW-143, FOLLOW-144`.)
- **PM CHOICE FLAG (not a new stub):** PM may alternatively re-open FOLLOW-143 (revert its DONE
  marker to PARTIAL — AC1 partially addressed, AC2/AC3/AC4/AC5 unfulfilled) and let FOLLOW-150
  scope shrink to just the residual `dpia.md:1017` reconciliation + comment sweep. This is a
  bookkeeping preference (RETRO-analyst is append-only on `FOLLOW_UPS.md`, cannot modify
  existing status fields). The recommendation here keeps FOLLOW-143 DONE (since the headline
  AC1 producer-wired half IS done) and folds the test-half + ACs 2-5 into FOLLOW-150's scope —
  but PM judgment prevails.

### 8. Cross-references

- **RETRO-023 (FOLLOW-139, PR #164 base commit)** — direct parent. RETRO-023 emitted FOLLOW-143
  + FOLLOW-144 + FOLLOW-145 + FOLLOW-146; this retro audits the inline closure of FOLLOW-143 +
  FOLLOW-144 inside the same PR before merge. RETRO-025 is the **verification-of-the-
  verification** loop closure: the inline fixes substantially closed RETRO-023's P0/P1 gaps but
  introduced one P1 test-coverage residual and one P1 doc-narrative residual, both folded into
  FOLLOW-150.
- **RETRO-019 / RETRO-020 / RETRO-018 (Rule N lineage)** — RETRO-025 is the FIFTH consecutive
  Rule N instance. Rule N already promoted (RETRO-019), amendment promoted (RETRO-023). No
  re-promotion; sub-amendment candidate logged at §6 below the threshold.
- **RETRO-024 (FOLLOW-141, PR #165)** — sibling retro from the same Sprint 13a-hardening-v2 wave.
  Independent surface (pilot-slug invariant); no cross-impact with RETRO-025 findings.
- **CONVENTIONS_PATCH.md Rule N + 2026-05-28 amendment** — applied as the verification framework
  for §3 CHECK B; the amendment Step 2 grep correctly surfaced the `dpia.md:1017` residual on a
  post-merge sweep, demonstrating the amendment's grep is well-calibrated. The dual-id-narrative
  shape is a NEW sub-axis below the threshold.
- **First retro of Sprint 13a-hardening-v3** (de-facto — the inline-fix verification wave that
  the user's prompt frames as "verification of the verification"). Sibling: **RETRO-026**
  (FOLLOW-149 / PR #166, parallel — independent surface, no expected cross-impact).

---

## RETRO-026 — FOLLOW-149 (migration journal repair + monotonicity CI guard + honest migrate.ts reporting + Part D 0015 apply on prd) — 2026-05-28

### 1. Summary of change

- **PR:** #166 (merged 2026-05-28 at 22:44 UTC+02:00, merge commit `073f5d6`). Four part commits:
  `8a384c6` (Part A — journal repair), `d6131f6` (Part B — CI gate + self-test),
  `109dfbb` (Part C — migrate.ts honest reporting), `be75cb3` (Part D — Rule O codification +
  ESC-012 + README update + Part D operational note documenting the isolated 0015 apply on prd).
  Worker = (multi-agent, attributed Pnawrocki9 + Claude Opus 4.7). Sprint 13a-hardening-v3 (new
  wave, P0 infra hardening). `depends_on:` discovered during FOLLOW-141 (PR #165) /
  ESC-012-triggering attempt to apply 0015 to prd. Source: live-session diagnostic 2026-05-28 that
  observed (a) `tenants.pilot_frozen` column ABSENT on prd despite a prior `pnpm db:migrate` run
  claiming success, and (b) drizzle-kit emitting 2025-stamped `when` values for entries 0015 +
  0016 on the local dev machine.
- **Files changed:** 7 (+593 / −5).
  - `.github/workflows/ci.yml` (+22) — new `migration-journal` job, `fetch-depth: 0`, runs the
    self-test before the real validation.
  - `CONVENTIONS_PATCH.md` (+66 / −1) — new **Rule O** ("Migration journal monotonicity +
    recency"), evidence cites c92da81 + FOLLOW-149.
  - `backlog/ESCALATIONS.md` (+42) — new **ESC-012** OPEN ("`pnpm db:migrate` against any env
    will fail until pilot tenant exists").
  - `packages/db/README.md` (+28) — new "Migration journal integrity (Rule O — FOLLOW-149)" section
    + the new exit-2 behavior of `migrate.ts` documented.
  - `packages/db/migrations/meta/_journal.json` (+4 / −2) — entries 15 and 16 `when` values
    repaired (15: `1748304000000` → `1779840001000`; 16: `1748736000000` → `1779986691000`).
  - `packages/db/scripts/migrate.ts` (+113 / −2) — full rewrite of the runner's reporting +
    exit-2 trap-killer.
  - `scripts/check-migration-journal.sh` (+323) — new bash + Node-inline gate with `--self-test`
    mode (4 fixtures: monotonicity violation, year-drift violation, orphan entry, known-good).
- **Modules touched:** db (packages/db: 1 script + 1 README + 1 journal patch) + ci (workflow +
  scripts root) + docs (CONVENTIONS_PATCH + ESCALATIONS). **No SDK, no apps/control-plane, no
  apps/decision-api, no apps/ingest, no data-engineer code, no production application code
  changed** — this is a pure infrastructure + process hardening PR.
- **Key contracts changed:**
  - `packages/db/scripts/migrate.ts` exit-code contract — **breaking on the operator surface**
    (intentional). Previously: always exited 0 and printed "Migrations applied successfully."
    Now: exits 0 only when `applied > 0 && pending === 0` OR `applied === 0 && pending === 0`
    (already up-to-date); exits **2** when `pending > 0 && applied === 0` (the trap-killer for
    silent skip) OR when `applied > 0 && pending > 0` (mixed/partial state). Operators or CI
    pipelines that previously assumed exit-0-always will now see a real failure when the
    journal-ordering bug is present. **This is the desired behavior** but is a breaking change to
    the operational contract — see §5c.
  - **NEW Rule O** in `CONVENTIONS_PATCH.md` lines 590–652 — three invariants on
    `packages/db/migrations/meta/_journal.json`: strict monotonic `when`, within 7 days of SQL
    file commit date, one-to-one tag↔SQL file mapping. Breaking: **no** (new gate; existing
    journal already conforms after Part A's repair).
  - **NEW CI job** `migration-journal` in `.github/workflows/ci.yml` — runs on every PR; gates
    merge if any of the three Rule O invariants is violated. Breaking: **no** (existing journal
    passes; future drizzle-kit year-drifted entries will be caught at PR time).
  - **NEW ESC-012** in `backlog/ESCALATIONS.md` — operational gotcha: `pnpm db:migrate` is no
    longer safe in tenant-less environments because migration 0016 (pilot_inquiry_selector,
    PR #165) ends with a `RAISE EXCEPTION` when the pilot tenant slug is missing, and Drizzle's
    pg-core migrator wraps all pending migrations in a single transaction. Breaking on dev /
    staging / any new region clone until TICKET-PILOT-001 seeds the pilot tenant. **This is a
    real operational regression and is correctly flagged for TICKET-PILOT-001 to resolve.**
  - No type, no API route, no DB-schema-DDL, no event-schema, no SDK-public-symbol changed.
  - **Runtime data state change (Part D, on prd only):** `drizzle.__drizzle_migrations` now
    contains entry 15 (`0015_pilot_frozen`, id=17, created_at=1779840001000,
    hash=06190fd447a42483390467b1a334f7925c77875c5c3c9a0a4044b1041aa92d10) — but **not** via
    `pnpm db:migrate` (because that would have rolled 0015 back when 0016 hit its RAISE), via a
    one-off isolated `BEGIN/INSERT/COMMIT` mirror of the migrator. Breaking: **no** for
    application code; **noteworthy:** `tenants.pilot_frozen` column is now present on prd.

### 2. Verification done in PR

- Test files changed: **NONE.** No new unit or integration test was added for `migrate.ts` Part C
  (the exit-2 trap-killer). The `--self-test` mode of `check-migration-journal.sh` (Part B) is the
  only new test artifact, and it lives INSIDE the script itself, exercised via CI invocation
  before the real journal validation.
- Assertions added: **4 in-memory fixtures** inside `scripts/check-migration-journal.sh:50-164`
  exercising monotonicity-violation (fixture 1), year-drift-violation (fixture 2),
  orphan-entry (fixture 3), and known-good (fixture 4). The self-test asserts that fixtures 1-3
  are REJECTED with exit 1 and fixture 4 is ACCEPTED with exit 0. **No test exists for `migrate.ts`
  Part C's `pending > 0 && applied === 0 → exit 2` branch** — see §4c TG-1.
- Coverage delta: **+** for `scripts/check-migration-journal.sh` (the script self-tests four
  invariant cases). **0 for `packages/db/scripts/migrate.ts`** — Part C's branch logic
  (applied/pending/before/after permutation handling, the exit-2 trap-killer, the
  appliedCount() "schema does not exist → 0" pre-first-migration handling) has no unit or
  integration test in `packages/db/src/__tests__/`. The PR ships behavior the script self-test
  cannot verify because the script self-test only validates the journal, not the runner.
- CI checks: PR merged 2026-05-28 22:44 UTC; per PR body merge gates green. Standing CI-gate
  caveat applies (Rule I / Vercel / Python lanes pre-existing-red & non-blocking, per the
  CI-gate-landscape memory). **The new `migration-journal` CI job has NO prior runs against a
  broken journal in this repo** — its in-CI correctness rests on the four self-test fixtures.
- AC verdict — **COMPLETE on the four-part scope.** All four parts (A: repair, B: CI gate +
  self-test, C: honest migrate.ts, D: 0015 applied to prd + Rule O codified + ESC-012 filed)
  shipped in one PR. The Part D operational gotcha (single-transaction migrator + 0016 RAISE)
  is properly escalated rather than papered over. Three caveats: (1) no test on `migrate.ts`
  Part C, (2) the drizzle-kit root-cause is unfixed (only guarded), (3) one phantom row anomaly
  in `drizzle.__drizzle_migrations` (id=17 for entry idx=15) flagged by user.

### 3. Wiring Audit

**CHECK A — Dead code detection:**

- `scripts/check-migration-journal.sh` (NEW) — invoked by `.github/workflows/ci.yml` (the
  `migration-journal` job) AND documented as a `pre-push` lefthook invocation
  (CONVENTIONS_PATCH.md Rule O lines 628–637) AND documented in `packages/db/README.md:195-203`.
  Framework-discovered (CI workflow), suppressed false positive per Step 6 rules. **Not dead.**
- `scripts/check-migration-journal.sh --self-test` mode — invoked by the same CI job ("CI invokes
  the self-test first so the gate's own correctness is provable on every run" — Rule O line 631).
  **Not dead.**
- `packages/db/scripts/migrate.ts` (HEAVILY MODIFIED, not new) — entrypoint of `pnpm db:migrate`
  (root `package.json` script). **Not dead.**
- `packages/db/scripts/migrate.ts:appliedCount()` (NEW internal function) — called twice inside
  the same file (before/after migrate). **Not dead** at the symbol level, but it's intentionally
  module-private (no `export`), so Rule I would not flag.
- **CHECK A clean ✅** (all new artifacts have at least one non-test invoker).

**CHECK B — Half-wire detection:**

- **`pnpm db:migrate` exit-code-2 contract** —
  - **Producer EXISTS ✅** at `packages/db/scripts/migrate.ts:107-118` (the `pending > 0 &&
    applied === 0 → process.exit(2)` branch) and `:122-128` (the mixed-state `applied > 0 &&
    pending > 0 → process.exit(2)` branch).
  - **Consumer — UNVERIFIED at the operational layer.** `grep -rn 'pnpm db:migrate' .github
    apps packages docs` finds invocations in (a) `packages/db/README.md` (3 callers, all docs),
    (b) `.github/workflows/post-migrate-seed.yml` likely (the auto-seed workflow per Sprint 11
    FOLLOW-063), (c) `docs/runbooks/` references. **No CI workflow / GitHub Actions job is
    documented to treat `exit 2` specially**; the standard shell behavior is "any non-zero =
    failed step", so CI will surface it correctly. **No producer/consumer mismatch:** standard
    POSIX exit-code semantics suffice; this is NOT a HALF_WIRE.
- **`check-migration-journal.sh --self-test` fixture mode (FIXTURE_MODE=1, FIXTURE_JOURNAL=...,
  FIXTURE_SQL_DIR=...)** —
  - **Producer EXISTS ✅** at `check-migration-journal.sh:60-68` (the `run_fixture()` helper
    sets the env vars and re-invokes `$0`).
  - **Consumer EXISTS ✅** at `check-migration-journal.sh:166-172` (the
    `if [[ "${FIXTURE_MODE:-0}" == "1" ]]; then` switch overrides `JOURNAL` and
    `MIGRATIONS_DIR`). Producer and consumer in the same file. **Not a half-wire.**
- **Rule O CI job name** (`migration-journal` in `.github/workflows/ci.yml`) —
  - **Producer EXISTS ✅** (new job stanza added by Part B).
  - **Consumer — N/A** (CI jobs are leaf nodes; nothing else in the repo references the job
    name). Standard CI pattern; **not a half-wire.**
- **`drizzle.__drizzle_migrations` row inserted by Part D's isolated apply (id=17, idx=15)** —
  - **Producer EXISTS ✅** (the one-off isolated `BEGIN/INSERT INTO drizzle.__drizzle_migrations
    /COMMIT` script that ran on prd 2026-05-28; not committed to the repo per PR text).
  - **Consumer EXISTS ✅** — `drizzle-orm/postgres-js/migrator` reads this table on every
    `migrate()` call to decide which entries to apply. The row's `created_at=1779840001000` is
    strictly greater than entry 14's `1779840000000` and strictly less than entry 16's
    `1779986691000`, so the migrator correctly skips it on the next run.
  - **Not a half-wire**, BUT see **Phantom row anomaly** below (§4b CB-1).
- **ESC-012 OPEN status** — the escalation entry describes the new operational constraint
  (`pnpm db:migrate` against tenant-less env = 0016 RAISE = 0015 rollback alongside). The
  required action names "TICKET-PILOT-001 (or earlier)" as the owner. Verified
  (`grep -n 'TICKET-PILOT-001' backlog/QUEUE.md`): TICKET-PILOT-001 is READY with a 2026-05-27
  unblock notice; the dependency on ESC-012 resolution is **NOT yet wired into the ticket's
  depends_on or AC list** (QUEUE.md lines 2288-2336 do not reference ESC-012 or FOLLOW-149). The
  escalation is properly filed but TICKET-PILOT-001's spec is not updated to require ESC-012
  resolution before the operator runs `pnpm db:migrate` for 0016+. → **FOLLOW-151 (P0)** wires
  the dependency explicitly.

**Summary:** All four new code artifacts are correctly wired. ESC-012 is properly filed but
TICKET-PILOT-001 does not yet name it as a depends_on / AC; **§3 produces ONE FOLLOW-UP
(FOLLOW-151 — wire ESC-012 into TICKET-PILOT-001 spec).** Rule O CI job is wired but unproven in
prod CI against a real violation; rest on the self-test for guarantee.

### 4. Discovered gaps

#### 4a. Logic gaps

- **LG-1 (P3 — acceptable risk per CEO/PM choice) — the drizzle-kit `when`-generation root cause
  is NOT fixed.** This PR addresses the symptom (silently-skipped migrations) with two guards
  (Part A repair + Part B CI gate) and a runtime trap-killer (Part C exit 2). But drizzle-kit on
  the affected developer machine continues to emit 2025-stamped `when` values. The pattern has
  now recurred TWICE (2026-05-18 commit `c92da81` repaired entries 6/8/9/10/11; 2026-05-28
  PR #166 repaired entries 15/16) — confirming a real upstream defect, not a one-off. **Decision
  rationale for accepting the gap:** Patching drizzle-kit itself requires (a) reproducing the
  bug deterministically on the dev machine, (b) raising upstream / forking, (c) ongoing
  maintenance. The CI gate (Part B) catches the defect at PR time before it reaches the journal;
  the runtime trap-killer (Part C) catches it at apply time if it ever escapes CI. Defense in
  depth is sufficient. **Severity P3 because:** the failure mode is now visible (gate fails OR
  runner exits 2 with a loud warning) instead of silent. Filed as a tracking note (no follow-up)
  but logged here in §6 as a candidate Rule promotion if the pattern recurs a third time
  (which would mean a defective second-line defense, not a defective upstream tool). **Acceptance
  is conditional on the PM/CEO endorsing it.** → **no FOLLOW filed (P3 acceptable)** but
  flagged in §5d for CEO/PM attention.
- **LG-2 (P0 — operational) — ESC-012 is filed but TICKET-PILOT-001's spec doesn't enforce its
  resolution.** QUEUE.md lines 2288-2336 list TICKET-PILOT-001 with depends_on covering Sprint
  13a-hardening tickets and update logs through 2026-05-27 evening, but the 2026-05-28-discovered
  ESC-012 (which directly affects step 5 of the TICKET-PILOT-001 AC list — "Set
  tenants.pilot_frozen=true on the shadow→live flip") is not added to the ticket's depends_on or
  AC. Without an explicit AC, a worker running TICKET-PILOT-001 might invoke `pnpm db:migrate`
  against staging/prod before the pilot tenant exists, hit 0016's RAISE, and roll back any future
  0017+ entries. The current workaround (the one-off isolated apply pattern used for 0015) is
  brittle and undocumented in the runbook. → **FOLLOW-151 (P0)** wires ESC-012 into
  TICKET-PILOT-001's AC list AND adds a runbook step naming the two equivalent resolution paths
  in ESC-012 ("either path 1 — wizard step calls db:migrate after tenant creation, OR path 2 —
  edit 0016 to RAISE NOTICE no-op when tenant absent").
- **LG-3 (P1) — migration 0016 is still pending in the journal.** Repaired entry 16's `when` is
  `1779986691000` (2026-05-28), strictly greater than entry 15's repaired `1779840001000`. After
  Part D's one-off 0015 apply, `drizzle.__drizzle_migrations` has 16 of 17 journal entries
  applied. The next caller of `pnpm db:migrate` against prd will pick up entry 16 and hit its
  RAISE EXCEPTION if the pilot tenant slug `'000-app-estalara'` is missing. **This is the same
  half-wire shape as FOLLOW-147 (RETRO-024 §3)**: entry 16 is producer-side present
  (committed SQL + journal entry) but consumer-side conditional (RAISE-on-missing-tenant). The PR
  text and ESC-012 correctly document this and assign resolution to TICKET-PILOT-001. → covered
  by FOLLOW-151 AC; no separate stub needed.
- **LG-4 (P2) — `migrate.ts:90-95` reads the journal at module-evaluation time
  (`const journalCount = readJournalCount();` + the top-level `await migrate(...)` immediately
  below).** If `_journal.json` is missing or malformed, the script throws an unhelpful error
  before the new `appliedCount()`/`migrate()` flow runs. A pre-flight validation
  (e.g., calling `bash scripts/check-migration-journal.sh` as the first action) would surface
  the precise violation. Low severity (the CI gate already catches this at PR time), but the
  runner is unilaterally trustful of journal shape at runtime. → folded into FOLLOW-152 AC as a
  hardening note.

#### 4b. Code bugs not caught

- **CB-1 (P2) — phantom row anomaly in `drizzle.__drizzle_migrations` (id=17 for migration 0015
  / idx=15).** Per the PR description for Part D: `drizzle.__drizzle_migrations` now contains
  entry 15 at `id=17`, `created_at=1779840001000`,
  `hash=06190fd447a42483390467b1a334f7925c77875c5c3c9a0a4044b1041aa92d10`. Expected: id=16 (15
  prior journal entries idx 0–14, all applied historically, plus the just-applied idx=15 = 16th
  row → id=16 in a 1-based serial). Observed: id=17, one higher than expected. Three candidate
  explanations (user-supplied + analyst diligence):
  1. **One of the c92da81 repair-added entries (0003/0004/0005/0007) was historically double-
     applied before the repair landed.** The 2026-05-18 c92da81 commit message says it "adds 4
     missing migration entries (0003 tenant_site_schemas, 0004 ab_bandit_weights, 0005 archetype
     seed, 0007 bandit seed)." If any of those 4 SQL files were applied manually (or by a
     subsequent migrator run that processed them after the repair) BEFORE the journal entries
     were added, the migrator could have inserted a row for them, and a later run would re-apply
     and re-insert because the journal-entry hash differed. **This is the most likely
     explanation** given the c92da81 history.
  2. **Drizzle re-records on hash mismatch.** If a journal entry's `hash` changes between runs
     (because the SQL was edited after a prior apply, even cosmetically), Drizzle could insert a
     new row rather than no-op. The Part A repair changed the `when` field but not `hash`
     (hashes are over SQL content, not journal metadata), so this is less likely — but worth
     verifying.
  3. **IDs aren't strictly 1-based in the prd table** — `id` may be `SERIAL` or `BIGSERIAL` and
     have skipped due to a rolled-back transaction (Drizzle's wrapping txn would NOT skip the
     SERIAL because PostgreSQL increments sequences outside the txn). Plausible if there was a
     prior failed `pnpm db:migrate` invocation that bumped the sequence.
  - **Verdict on whether this is a real bug:** Explanation 3 (sequence skip due to rolled-back
    txn — which we know happened today when 0016's RAISE rolled back 0015 the first time, before
    Part D's isolated apply) is **the most likely explanation given the day's events** — the
    failed `pnpm db:migrate` attempt that triggered ESC-012 INSERTed a row for 0015 inside the
    txn, the txn rolled back, but the `__drizzle_migrations.id` SERIAL incremented to 17 (or to
    16 for the rolled-back attempt, then 17 for the Part D isolated apply). PostgreSQL SEQUENCE
    semantics confirm this: `nextval()` is NOT rolled back when the surrounding txn aborts. **So
    the phantom row is most likely a numbering quirk from a rolled-back txn, not a real bug.**
  - **Stub-worthy?** Confirming this requires reading the prd
    `drizzle.__drizzle_migrations` table directly (`SELECT id, hash, created_at FROM
    drizzle.__drizzle_migrations ORDER BY id`) and comparing the 17 rows to the 16 expected
    entries. If the row count is **17** with one duplicate-hash entry → explanation 1 confirms.
    If the row count is **16** with `MAX(id) = 17` → explanation 3 confirms. The user surfaced
    this as a known oddity and asked the retro to either explain or file a stub. **Filing as
    FOLLOW-152 (P2) — diagnostic SELECT + brief written confirmation in `docs/runbooks/db-
    operations.md` or a new ADR-NNNN.** Low severity: even if explanation 1 is correct
    (historical double-apply), the row that's "phantom" is for an already-completed migration,
    not one that's silently inert. → **FOLLOW-152 (P2).**
- **CB-2 (P2) — `check-migration-journal.sh:225` uses
  `journal.entries[journal.entries.indexOf(entry) - 1]?.idx` to identify the prior entry, but
  `.indexOf(entry)` on an object array is O(n) and relies on reference equality** (the loop
  iterates the same array). Functionally correct but a sloppy idiom; a sibling `const prevIdx`
  tracked alongside `prev` and `prevTag` would be clearer and O(1). Cosmetic; no follow-up.
- **CB-3 (P2) — the runtime `appliedCount()` schema-doesn't-exist check at `migrate.ts:79` uses
  regex `/does not exist|relation .* does not exist/i.test(msg)`.** This is permissive enough to
  swallow other "X does not exist" errors (e.g., `database "estalara" does not exist`,
  `extension "uuid-ossp" does not exist`, etc.) and treat them as `before = 0`. The narrower
  intended match is `"schema \"drizzle\" does not exist"` or
  `"relation \"drizzle.__drizzle_migrations\" does not exist"`. False positives are unlikely
  (the surrounding context is a known pg query), but a future operator running against a
  malformed connection string would get a misleading "Already up-to-date" instead of the real
  connection error. → folded into FOLLOW-152 AC as a tightening note.

#### 4c. Test coverage gaps

- **TG-1 (P0) — NO unit test exists for `migrate.ts` Part C's exit-2 trap-killer behavior.** The
  user explicitly asked this question. `packages/db/src/__tests__/` contains 4 files
  (`ab_bandit_weights.test.ts`, `archetype_embeddings_seed.test.ts`, `client.test.ts`,
  `pilot_inquiry_selector.test.ts`); none exercises `migrate.ts`. The new exit-2 branch
  (`pending > 0 && applied === 0`) is the central trap-killer the PR was designed around. It is
  validated by zero tests; its correctness rests on visual inspection. A reasonable test would
  mock `appliedCount()` to return `0` before and `0` after with `journalCount = N > 0`, invoke
  the runner, and assert `process.exit(2)` was called with the warning text. The structurally-
  analogous test for `check-migration-journal.sh:--self-test` mode does NOT cover `migrate.ts`'s
  branch logic. → **FOLLOW-152 (P0 sub-AC)** adds a vitest unit test covering the 4
  permutations: (a) `applied > 0 && pending === 0` → exit 0 with success line, (b) `applied
  === 0 && pending === 0` → exit 0 with "Already up-to-date", (c) `pending > 0 && applied
  === 0` → exit 2 with the FOLLOW-149 warning, (d) `applied > 0 && pending > 0` → exit 2 with
  the partial-success warning. (Same FOLLOW absorbs the LG-4 / CB-3 fixes + the CB-1 phantom
  row diagnostic.)
- **TG-2 (P1) — the Rule O self-test does NOT exercise a real journal-vs-stale-git-history
  scenario.** Fixture 2 (year-drift violation) uses `: > <path>/0000_yearbug.sql` to create an
  empty file, whose `mtime` defaults to "now" (2026), so the recency check naturally fails
  against a 2025-stamped `when`. It does NOT exercise the git-log fallback path
  (`getSqlTimestampSeconds()` lines 264-275) because `FIXTURE_MODE=1` short-circuits the git
  block (line 265: `if (!IS_FIXTURE) { try { ... git log ... } }`). A real journal violation
  that comes from a committed-but-misdated SQL file would go through the git path; the
  self-test never reaches it. → **FOLLOW-153 (P2)** adds a self-test fixture that creates a
  tiny ephemeral git repo (`git init`, commit a SQL file with `GIT_AUTHOR_DATE` set to
  2026-05-28) and asserts the recency check against the git-log timestamp, not the mtime
  fallback. Low priority (the mtime fallback covers ~90% of real cases and the git path is
  simple), but worth covering before the gate's confidence is bet on a launch.
- **TG-3 (P2) — no integration test exists that runs `pnpm db:migrate` against an
  intentionally-broken journal (e.g., a year-drifted fixture entry) and asserts the runner
  exits 2.** A Testcontainers or pgmem-based integration test could exercise the full Part B
  + Part C chain. Same gap as the FOLLOW-147 / RETRO-024 §4c TG-1 concern (every `packages/db/
  src/__tests__/` file ships only structural assertions, never live DB exercises). → folded
  into FOLLOW-152 AC as a stretch goal (full integration is out of scope; mocking is acceptable).

#### 4d. Documentation gaps

- **DG-1 (P1) — TICKET-PILOT-001's spec file (`backlog/sprint-12/TICKET-PILOT-001.md`, per
  QUEUE.md L2299) does NOT reference ESC-012 or the FOLLOW-149 operational gotcha.** QUEUE.md's
  entry for the ticket (L2288-L2336) mentions the FOLLOW-106 pilot_frozen flag in step 5 but
  not the single-transaction migrator constraint. The spec file is the canonical reference for
  the worker who picks this ticket up; without an explicit AC for ESC-012 resolution, the
  worker will follow the now-broken `pnpm db:migrate` step. → covered by FOLLOW-151.
- **DG-2 (P1) — Master Design has no changelog entry for the v3.3+ infra hardening (FOLLOW-149
  + ESC-012 + Rule O).** The user noted "Master Design changelog being written separately"; this
  retro does not block on it, but flags the gap. The post-PR-#165 v3.3 changelog mentions
  TICKET-PILOT-001 readiness through 2026-05-27 evening; the 2026-05-28 FOLLOW-149 PR + ESC-012
  shifts the operational landscape (Lane B is now gated on ESC-012 resolution, not just
  the Lane A hardening tickets). → tracked in QUEUE.md L3-L20 (per `head -100` reading); the
  master design will need a v3.4 changelog. **Outside retro scope** (Master Design is the PM /
  CEO's editorial; not the retro-analyst's). → no FOLLOW filed; flagged for PM in §5.
- **DG-3 (P2) — `docs/runbooks/db-operations.md` does NOT exist** (verified: no file at that
  path; the only `docs/runbooks/` file referenced in the codebase is `vendor-accounts.md` in
  ESC-008 context). The Part D one-off isolated apply pattern (mirror of Drizzle's per-entry
  logic for single-migration applies) is a non-trivial operational technique that is now part
  of the team's toolbox but is documented nowhere. → folded into FOLLOW-151 AC (PILOT_RUNBOOK is
  the natural home; or create `docs/runbooks/db-operations.md` if the pattern is general
  enough). The pattern recurrence after the c92da81 + FOLLOW-149 history is high; codify before
  it's forgotten.
- **DG-4 (P2) — the `migrate.ts` exit-2 behavior is documented in `packages/db/README.md:181-184`
  (Part D added this) and in CONVENTIONS_PATCH.md Rule O lines 638-642, but is NOT documented
  in the operator-facing `pnpm db:migrate` script invocation chain.** A new operator running the
  command from the repo root has no in-terminal way to know that "exit 2" is a real
  diagnostic, not a generic failure. The warning text the runner emits (`migrate.ts:108-117`) is
  good — but only after the migration runs. A `pnpm db:migrate --help` or a header banner is not
  in scope; noted for future ergonomics work. → no FOLLOW filed.

### 5. Cascading impact

#### 5a. Current sprint tickets affected

- **TICKET-PILOT-001 (Sprint 13b Lane B, READY, QUEUE.md L2288-L2336) — directly affected by
  ESC-012.** The ticket's step 5 ("Set tenants.pilot_frozen=true on the shadow→live flip — opens
  the measurement window") now has a tacit prerequisite (the pilot tenant row must exist in
  `tenants` before any future `pnpm db:migrate` run, OR the operator must use the one-off
  isolated apply pattern for 0016). Without a spec update, a worker will pick this up and
  re-trigger the exact failure mode that ESC-012 documents. **PM action:** add ESC-012 to
  TICKET-PILOT-001's depends_on; add AC step 6 ("verify ESC-012 resolution path before invoking
  pnpm db:migrate"). Flagged per constraint 3 for PM/CEO attention; this is a P0 pilot-
  readiness item.
- **FOLLOW-147 (RETRO-024, P0 OPEN, pilot-slug verification) — TIGHTLY COUPLED with FOLLOW-151.**
  Both follow-ups touch TICKET-PILOT-001's pre-shadow→live checklist. FOLLOW-147 fixes the
  migration 0016 invariant verification (data-engineer + backend-engineer); FOLLOW-151 (this
  retro) wires ESC-012 into the ticket's depends_on (PM / architect editorial). The PM should
  consider promoting both into a single TICKET-PILOT-001-PREFLIGHT consolidation rather than
  two parallel follow-ups — but the retro keeps them separate per scope discipline.
- **FOLLOW-141 (PR #165, DONE — pilot inquiry_submit_selector seed) — its production
  applicability is now CONDITIONAL on ESC-012 resolution.** The 0016 migration is committed but
  unapplied; until either (a) TICKET-PILOT-001 seeds the pilot tenant before `pnpm db:migrate`
  runs, or (b) someone uses the one-off isolated apply pattern, the pilot's
  `inquiry_submit_selector` column remains NULL. RETRO-024's FOLLOW-147 (verify migration 0016's
  WHERE-clause invariant) is now joined by FOLLOW-151 (wire ESC-012). FOLLOW-141's status in
  `backlog/FOLLOW_UPS.md` may need to flip from "DONE — PR #165" to "DONE pending ESC-012
  resolution before 0016 actually applies to prd." → PM editorial.
- **FOLLOW-092 (TICKET-PILOT-001 shadow-window measurement, BLOCKED) — UNCHANGED.** Still
  downstream of TICKET-PILOT-001 + Lane A. ESC-012 adds one more reason for the dependency.
- **RETRO-025 sibling (FOLLOW-150, P1, OPEN) — independent surface; no cross-impact.** RETRO-025
  audits PR #164 inline fixes (SDK xid wiring + §13.2 cadence reconciliation). RETRO-026 audits
  PR #166 infra hardening. Both belong to the de-facto Sprint 13a-hardening-v3 wave but touch
  disjoint files (SDK + compliance docs vs. db scripts + CI workflow).

#### 5b. Future sprint tickets affected

- **TICKET-PILOT-002 (go/no-go runbook, BLOCKED) — affected.** The PILOT_RUNBOOK §3 + §5 author
  must now include the apply-and-verify step for migration 0016 (FOLLOW-147 AC4) AND the
  ESC-012 resolution path (FOLLOW-151 AC). The two follow-ups overlap in the runbook surface;
  the TICKET-PILOT-002 worker must reconcile.
- **Future migration authors (data-engineer, ml-engineer, anyone generating a new migration) —
  affected.** Rule O now requires every new migration's `when` to be (a) strictly monotonic and
  (b) within 7 days of the SQL file's commit date. The "how to apply when you generate a new
  migration" steps in CONVENTIONS_PATCH.md lines 644-651 (and `packages/db/README.md:186-208`)
  are mandatory reading for every PR adding a migration. **The CI gate enforces this** — but
  workers should pre-check locally with `bash scripts/check-migration-journal.sh` to avoid red
  CI cycles. → no follow-up needed; the rule is self-enforcing via CI.
- **TICKET-PROCESS-001 follow-on (the agent-skill upgrade — commit `24eceff` "chore(agents):
  upgrade all 10 skill files from retrospective evidence") — partially affected.** The
  data-engineer + backend-engineer skill files should reference Rule O and the FOLLOW-149
  pattern in their migration-authoring guidance. Not retro scope; flagged for the next
  agent-skill refresh cycle.
- **Sprint 14 (YELLOW audit Sprint 2–4 reserved stubs FOLLOW-132..138) — N/A.** No YELLOW item
  involves migration journal mechanics.

#### 5c. Contracts changed that other modules rely on

- **Operational contract — `pnpm db:migrate` exit-code semantics.** Previously "always exit 0
  with green text"; now "exit 0 only on real success or no-op; exit 2 on detectable trouble."
  This is **breaking on the operator surface**, but the only "consumer" of the prior contract
  was the operator's eyeball reading "Migrations applied successfully." The new contract is
  strictly more honest. CI workflows that invoke `pnpm db:migrate` (the post-migrate-seed
  workflow, any Terraform apply hook, future deploy pipelines) will correctly treat exit 2 as a
  failure. **No code change is required in callers**, only operator/CI mental-model alignment.
- **Operational contract — `pnpm db:migrate` against a tenant-less environment now fails loudly
  on 0016.** ESC-012 documents this. Dev / staging / fresh region clones / any DB without the
  pilot tenant slug will hit 0016's RAISE on next invocation. This is also a breaking change to
  the operational contract but is documented in ESC-012 and (after FOLLOW-151) in TICKET-PILOT-
  001 + PILOT_RUNBOOK. The systemic constraint is real and persists until ESC-012 is resolved
  via one of the two paths.
- **Contract — `_journal.json` must satisfy Rule O.** Every future PR adding a migration is
  subject to the three invariants. No existing module relies on this as a precondition (it's a
  CI-enforced project rule, not a runtime API), so no downstream consumer is affected. The
  existing journal already conforms after Part A's repair.

#### 5d. Architectural assumptions affected

- **"Migration application is a black-box success/failure" assumption — RETIRED.** Before this
  PR, the assumption was that `pnpm db:migrate` either succeeded (green) or threw (red). The
  silent-success failure mode (drizzle skips an entry, runner reports success) was an
  unrecognized third state. FOLLOW-149 makes the three states explicit: success, no-op, partial
  failure (exit 2). Future operators must internalize the three-state model.
- **"drizzle-kit is correct" assumption — DEGRADED.** The 2026-05-18 + 2026-05-28 recurrences of
  the year-drift bug confirm a real upstream defect. This PR's response is "guard, do not fix"
  (Part B CI gate + Part C runtime trap, but no upstream patch or fork). **PM/CEO acceptance
  required** — see §4a LG-1. If a third year-drift incident occurs (a fortiori with the gate
  in place, it would be caught at PR time before reaching `_journal.json`, but the local-dev
  friction would persist), the team should reconsider patching drizzle-kit. Below the
  retrospective threshold today; no rule promotion.
- **"`drizzle.__drizzle_migrations.id` is a strict 1-based incrementing counter" assumption —
  POTENTIALLY WRONG.** The phantom row anomaly (CB-1) suggests the SERIAL may have skipped due
  to a rolled-back transaction. PostgreSQL SEQUENCE semantics confirm sequences are
  non-transactional. Future code that reads `__drizzle_migrations.id` for ordering MUST use
  `created_at` (the journal `when` value), NOT `id`. No existing code in the repo reads `id` for
  ordering (verified by grep), so no impact today; logged here for future migration tooling
  authors. → covered by FOLLOW-152 (the diagnostic SELECT confirms the explanation).
- **"Schema-level transaction wrapping by Drizzle migrator is safe" assumption — CHALLENGED.**
  Drizzle's pg-core migrator wraps ALL pending migrations in ONE transaction
  (`drizzle-orm/pg-core/dialect.js:60`). When migration N's failure rolls back migration N-1,
  N+1, ..., this is technically correct ACID behavior but operationally surprising. The
  RAISE-on-missing-tenant pattern in 0016 (a deliberate guard, FOLLOW-141 design) is now in
  direct conflict with this transactional behavior. The systemic architecture choice is "either
  one txn per migration (Drizzle's behavior) OR one txn per all-pending (Drizzle's behavior),
  pick one consistently" — the team has implicitly chosen the latter. Future RAISE-EXCEPTION
  guards in migrations must consider this rollback radius. → escalation-worthy as a design
  guideline; for now, ESC-012's "edit 0016 to RAISE NOTICE instead of RAISE EXCEPTION" path
  resolves the immediate issue.

### 6. New lesson candidates

- **Pattern — "tooling output reports success when it did not actually do the work" (silent-
  success bug in operator tooling).** Seen in this retro (`migrate.ts` printing "Migrations
  applied successfully." with zero applied). The user-supplied note observed this is the second
  instance after Rule N's HALF_WIRE pattern of "code says success when it didn't actually do the
  work" — though Rule N's specific shape is "compliance disclosure asserts behavior the code
  doesn't perform", which is a different axis (disclosure vs. operator-tool output).
  - **Count of the narrower "operator tool reports success when it did nothing" pattern:** 1
    (this retro). Sibling RETRO-025 (which landed before this retro was written and was
    re-read) DID NOT surface an operator-tooling silent-success pattern — RETRO-025's findings
    (HALF_WIRE_T integration-test gap; dual-id narrative collision in dpia.md:1017) are doc /
    test-coverage shapes, not operator-tool silent-success shapes. **Below the dedicated
    promotion threshold of 2.** NOT promoted as a new Rule. Logged here so the NEXT retro
    crosses the threshold; promote a Rule P "tooling output must reflect reality, not
    optimism" when the second instance lands. Sketch verification:
    ```bash
    # In any operator-facing script, success messaging MUST be gated on a positive observation,
    # not an unconditional println at end of script.
    grep -rn "console.log.*success\|echo.*success\|print.*success\|✅\|Successfully" \
      packages/*/scripts apps/*/scripts scripts/ --include="*.ts" --include="*.sh"
    # Each match should be inside a conditional that checks an actual side-effect count.
    ```
  - **Sister candidate — the cadence-mismatch Rule N amendment (RETRO-023)** is the same root
    cause class ("artifact claims state X; reality is state Y") but applied to a different
    surface (compliance disclosure vs. operator tooling). The two patterns are siblings, not
    instances of the same rule. The Rule N amendment is already in place; this pattern is its
    operator-tooling cousin.
  - **Decision:** **NOT promoted today.** Promote to Rule P when the second instance lands.

- **Pattern — "second-line defense for an unfixed upstream tool defect" (Rule O response shape).**
  This PR's response to drizzle-kit's year-drift bug is "guard at PR time + guard at run time,
  do not patch upstream." The pattern is a deliberate architectural choice (the team accepts
  P3 ongoing local-dev friction in exchange for not maintaining a fork). Seen once before
  (commit c92da81 was a one-off journal patch, no permanent guard — this PR is the first time
  the response has been formalized as a Rule). **Count = 1.** Below threshold. Logged as a
  candidate for a future "Rule Q — when to fork-and-patch vs. guard-and-tolerate an upstream
  tool defect" if the team encounters another instance. Below threshold; not promoted.

- **Pattern — "operational gotcha discovered during a hardening PR is filed as a new
  escalation, not buried in PR body."** This PR filed ESC-012 the moment the Drizzle single-txn
  + 0016 RAISE behavior was discovered, rather than papering over it with `--no-verify` or a
  hack. **This is a positive pattern worth reinforcing as a process norm** (it already aligns
  with CLAUDE.md "agents MUST escalate when..." guidance). Not a Rule candidate; just praise.

- **Rule O — provisional pending second occurrence.** Per user instruction, Rule O was added by
  this PR with 1 occurrence (FOLLOW-149 itself; the c92da81 precedent is cited in evidence but
  the rule was not promoted then). The threshold for permanent promotion is 2 retro-discovered
  instances. Rule O therefore exists in CONVENTIONS_PATCH.md (lines 590-652) but is
  **provisional**: the first occurrence is c92da81 (2026-05-18, no retro filed at the time
  because it was a single-commit fix), and the second is FOLLOW-149 itself (this retro). **The
  analyst counts this as the first RETRO-recorded occurrence and the c92da81 commit as the
  pre-retro precedent.** Per the no-double-promotion + ≥2-retros-required rule, **Rule O
  should be treated as provisional, not permanent, until a future retro identifies a third
  instance OR a second occurrence on top of FOLLOW-149.** This retro **does not modify
  CONVENTIONS_PATCH.md** because Rule O was already added by PR #166 itself in commit
  `be75cb3`. The provisional status is recorded here for the next retro that touches a
  migration to verify.

- **No new Rule promoted this retro. No CONVENTIONS_PATCH.md edit by this retro-analyst run.**
  Rule O remains as PR #166 shipped it (provisional). The candidate Rule P ("tooling output
  must reflect reality, not optimism") is below the promotion threshold (1 instance).

### 7. Follow-ups

- **FOLLOW-151** (architect + PM, 1h, **P0**, must close BEFORE TICKET-PILOT-001 spawn): wire
  ESC-012 into TICKET-PILOT-001. (a) Add ESC-012 to TICKET-PILOT-001's depends_on in
  `backlog/sprint-12/TICKET-PILOT-001.md` AND in the QUEUE.md entry (L2288-L2336). (b) Add a new
  AC step (between current steps 4 and 5) requiring the worker to choose and execute one of
  ESC-012's two resolution paths (path 1 — seed pilot tenant before db:migrate; path 2 — edit
  0016 to RAISE NOTICE no-op when tenant absent) AND document the choice in PR description.
  (c) Update `docs/ops/PILOT_RUNBOOK.md` §3 (Pre-live validation) to include the ESC-012
  one-off isolated apply pattern as a recovery technique (or create
  `docs/runbooks/db-operations.md` if the pattern is general enough to host outside the pilot
  runbook). (d) Once ESC-012 is resolved (one of the two paths executed), update ESC-012's
  status from OPEN to RESOLVED with the chosen path documented. Closes §3 ESC-012 wiring gap,
  §4a LG-2 + LG-3 (migration 0016 still pending), §4d DG-1 + DG-3.
  (`source_retro: RETRO-026`, `depends_on: FOLLOW-149`.)

- **FOLLOW-152** (backend-engineer + data-engineer, 2h, **P1 with one P0 sub-AC**, Sprint 13b
  hardening — within 7 days of merge to lock in test coverage on the new exit-2 contract):
  test + harden `migrate.ts` Part C + investigate the phantom row anomaly. (a — P0)
  Add a vitest unit test in `packages/db/src/__tests__/migrate.test.ts` (new file) with
  `vi.mock` over `appliedCount()` + `migrate()` that asserts the 4 permutation outcomes:
  `applied>0 && pending===0` → exit 0 + success line; `applied===0 && pending===0` → exit 0 +
  "Already up-to-date"; `pending>0 && applied===0` → exit 2 + FOLLOW-149 warning; `applied>0 &&
  pending>0` → exit 2 + partial-success warning. Use `process.exit` spy. (b — P2) Tighten the
  `appliedCount()` schema-doesn't-exist regex at `migrate.ts:79` to match only
  `"schema \"drizzle\" does not exist"` or
  `"relation \"drizzle.__drizzle_migrations\" does not exist"` — not a generic `does not exist`.
  (c — P2) Add a pre-flight invocation of `bash scripts/check-migration-journal.sh` at the
  start of `migrate.ts` (or document in README why we don't) — closes LG-4 hardening note. (d
   — P2 — the phantom row diagnostic) Run `SELECT id, hash, created_at FROM
  drizzle.__drizzle_migrations ORDER BY id` against prd; if 17 rows + a duplicate-hash row
  exists → explanation 1 (historical double-apply); if 16 rows + max(id)=17 → explanation 3
  (rolled-back SERIAL bump). Document the finding in `docs/runbooks/db-operations.md` (or new
  ADR-NNNN). Closes §4b CB-1 + CB-3, §4c TG-1 + TG-3, §4a LG-4, §5d "drizzle__migrations.id
  is strict 1-based" assumption.
  (`source_retro: RETRO-026`, `depends_on: FOLLOW-149`.)

- **FOLLOW-153** (devops-engineer, 1.5h, **P2**, Sprint 13b or 14): harden the Rule O
  self-test fixture coverage. Add a fifth self-test fixture that creates a tiny ephemeral git
  repo (`git init` in tmp dir, commit a SQL file with `GIT_AUTHOR_DATE` env override set to
  2026-05-28T22:00:00Z, then run the validator against it without `FIXTURE_MODE=1`) to
  exercise the `git log --diff-filter=A --format=%ct` path that the current four fixtures
  short-circuit. Asserts the recency check correctly uses the git-log timestamp, not the
  mtime fallback. Optional: also fixture-6 that asserts a SQL file edited AFTER its initial
  commit (so git-log returns the OLDER timestamp but mtime returns NEWER) is graded against
  the git-log date, not mtime. Closes §4c TG-2.
  (`source_retro: RETRO-026`, `depends_on: FOLLOW-149`.)

- **Carry-forward observations (no new stub):**
  - **LG-1 (P3 — accept drizzle-kit upstream defect)** — PM/CEO endorsement implicit by
    accepting this PR's "guard, do not patch" architectural choice. If a third year-drift
    incident occurs OR a similar drizzle-kit defect surfaces on a different field, re-litigate
    via a fresh ADR proposal.
  - **DG-2 (Master Design v3.4 changelog for FOLLOW-149 / ESC-012 / Rule O)** — outside retro
    scope; flagged for PM editorial. QUEUE.md L3-L20 already covers the change at the
    queue-status level.
  - **FOLLOW-141 status in `backlog/FOLLOW_UPS.md`** may need PM editorial to reflect that
    migration 0016 (PR #165) is committed-but-not-yet-applied-on-prd due to ESC-012. Not a
    retro-analyst edit; PM decision.

- **Wave roll-up (second retro of Sprint 13a-hardening-v3, sibling to RETRO-025):** RETRO-025
  (sibling, PR #164 inline fixes for FOLLOW-143/144) consumed **FOLLOW-150** (per the ledger
  updated by RETRO-025); per user instruction RETRO-026 was directed to start at FOLLOW-150 to
  avoid collision, but RETRO-025 landed FIRST in the file and already took FOLLOW-150 — so
  RETRO-026 starts at **FOLLOW-151** per the post-RETRO-025 ledger ("NEXT FREE FOLLOW NUMBER
  IS 151"). The two retros cover the two-PR wave (PR #164 + PR #166). Net P0 blockers for PM
  triage across the wave: **FOLLOW-151 (P0, this retro)** wires ESC-012 into TICKET-PILOT-001
  (must close before spawn); FOLLOW-150 (P1, RETRO-025) closes the FOLLOW-143 integration test
  + §13.2 dual-id reconciliation; FOLLOW-147 (P0, RETRO-024 — still open) is the third pilot-
  readiness P0 from the prior wave. **ESC-012 itself remains OPEN** — its resolution is owned
  by TICKET-PILOT-001 per the escalation's required-action block.

### 8. Cross-references

- **RETRO-024 (FOLLOW-141, PR #165) — direct ancestor.** RETRO-024 surfaced the inquiry-selector
  migration 0016 with its RAISE-EXCEPTION guard. The live-session attempt to apply 0016 to prd
  (2026-05-28) is what triggered the discovery of the single-transaction rollback + the
  unrelated journal year-drift bug for 0015 + 0016. RETRO-026 is the systemic-fix retro for
  the infrastructure gaps RETRO-024's diagnostic session exposed.
- **RETRO-025 (PR #164 inline-fix verification) — sibling in Sprint 13a-hardening-v3 wave.**
  RETRO-025 covers the SDK + compliance-doc surface (xid wiring + §13.2 cadence reconciliation);
  RETRO-026 covers the infrastructure surface (migration journal + CI gate + migrate.ts trap-
  killer). Disjoint files; no cross-impact. RETRO-025 consumed FOLLOW-150; RETRO-026 starts at
  FOLLOW-151 per the post-RETRO-025 ledger.
- **Commit c92da81 (2026-05-18, no retro)** — first observed instance of drizzle-kit year-drift
  (entries 6/8/9/10/11). No retro was filed at the time (it was a one-off journal patch). The
  Rule O evidence block in CONVENTIONS_PATCH.md lines 604-606 cites this as the first instance.
- **CONVENTIONS_PATCH.md Rule O (lines 590-652)** — promoted by PR #166 itself (commit
  `be75cb3`), provisional pending second retro-recorded occurrence. RETRO-026 logs it as the
  first retro-recorded occurrence; Rule O is provisional until a future retro confirms it via a
  second instance.
- **CONVENTIONS_PATCH.md Rule N (lines 515-588) — sibling pattern shape.** Rule N covers
  "compliance disclosure asserts behavior the code doesn't perform." The FOLLOW-149 silent-
  success bug in `migrate.ts` is the operator-tooling cousin: "operator tool reports success
  when it did nothing." Same root-cause class; different surface. Logged in §6 as a candidate
  for future Rule P promotion.
- **ESC-012 (this retro, NEW, OPEN)** — directly downstream; resolution owned by
  TICKET-PILOT-001 (per the escalation's required-action block) and now wired via FOLLOW-151.
- **CONVENTIONS_PATCH.md Rule H (lines 156-311) — distant cousin.** Rule H covers
  "schema/Zod scaffold without a runtime-wired consumer." FOLLOW-149's `migrate.ts` Part C
  trap-killer + Rule O CI gate are the *operator-tooling equivalent* of Rule H's runtime-wired
  consumer enforcement: in both cases, the team is closing a gap where an artifact (schema or
  tool output) failed to align with what a downstream consumer (the consuming code path or the
  human operator) was depending on. Not a promotion candidate; logged for conceptual continuity.
- **SECOND of Sprint 13a-hardening-v3 retros** — siblings: RETRO-025 (PR #164 inline-fix
  verification). The wave is two-PR (PR #164 + PR #166), both merged 2026-05-28 within hours
  of each other. RETRO-025 + RETRO-026 close the wave's retro coverage.

---

<!-- RETRO-027 and beyond will be appended here by the retrospective-analyst agent. -->
<!-- AUTHORITATIVE NUMBERING LEDGER (updated 2026-05-28 after RETRO-026 / PR #166 — second & FINAL Sprint 13a-hardening-v3 retro):
     - RETRO coverage: ...RETRO-019=PR#159/FOLLOW-129 (Sprint 13a-hardening, 1st of 4),
       RETRO-020=PR#160/FOLLOW-128 (Sprint 13a-hardening, 2nd of 4),
       RETRO-021=PR#161/FOLLOW-127 (Sprint 13a-hardening, 3rd of 4),
       RETRO-022=PR#162/FOLLOW-122 (Sprint 13a-hardening, 4th & FINAL),
       RETRO-023=PR#164/FOLLOW-139 (Sprint 13a-hardening-v2, 1st of 2 — initial commit),
       RETRO-024=PR#165/FOLLOW-141 (Sprint 13a-hardening-v2, 2nd & FINAL),
       RETRO-025=PR#164/FOLLOW-143+144 inline fixes (Sprint 13a-hardening-v3, 1st — verification-of-the-verification),
       RETRO-026=PR#166/FOLLOW-149 (Sprint 13a-hardening-v3, 2nd & FINAL — migration journal repair + monotonicity CI gate + honest migrate.ts).
       Next retro = RETRO-027.
     - FOLLOW numbers consumed: ...143-146 (RETRO-023), 147-148 (RETRO-024),
       149 (PR #166 itself — repaired journal + Part B CI gate + Part C migrate.ts + Part D Rule O / ESC-012),
       150 (RETRO-025 — close FOLLOW-143 AC1 integration test + reconcile §13.2 dpia.md:1017 dual-id narrative + sweep stale comment + dual-id docblock),
       151 (RETRO-026 — wire ESC-012 into TICKET-PILOT-001 spec + PILOT_RUNBOOK apply-and-verify recovery pattern),
       152 (RETRO-026 — vitest unit test for migrate.ts Part C exit-2 trap-killer + tighten appliedCount regex + diagnose phantom row id=17 + pre-flight check call),
       153 (RETRO-026 — self-test fixture for git-log recency path in check-migration-journal.sh).
     - NEXT FREE FOLLOW NUMBER IS 154. -->
<!-- AUTHORITATIVE NUMBERING LEDGER (updated 2026-05-28 after RETRO-025 / PR #164 inline-fix verification — first Sprint 13a-hardening-v3 retro):
     - RETRO coverage: ...RETRO-019=PR#159/FOLLOW-129 (Sprint 13a-hardening, 1st of 4),
       RETRO-020=PR#160/FOLLOW-128 (Sprint 13a-hardening, 2nd of 4),
       RETRO-021=PR#161/FOLLOW-127 (Sprint 13a-hardening, 3rd of 4),
       RETRO-022=PR#162/FOLLOW-122 (Sprint 13a-hardening, 4th & FINAL),
       RETRO-023=PR#164/FOLLOW-139 (Sprint 13a-hardening-v2, 1st of 2 — initial commit),
       RETRO-024=PR#165/FOLLOW-141 (Sprint 13a-hardening-v2, 2nd & FINAL),
       RETRO-025=PR#164/FOLLOW-143+144 inline fixes (Sprint 13a-hardening-v3, 1st — verification-of-the-verification).
       Next retro = RETRO-026 (parallel, PR#166/FOLLOW-149).
     - FOLLOW numbers consumed: ...139 (RETRO-019), 140 (RETRO-020),
       141 (RETRO-021), 142 (RETRO-022),
       143 (RETRO-023 — wire getOrCreateCrossSessionId into init — DONE inline in PR #164),
       144 (RETRO-023 — reconcile "monthly"/"30 days" cadence claim with 90-day TTL — DONE inline in PR #164),
       145 (RETRO-023 — Withdraw button UI affordance — OPEN),
       146 (RETRO-023 — thread xid onto event wire / ingest join key — OPEN),
       147 (RETRO-024 — pilot-slug verification + post-apply assertion + PILOT_RUNBOOK step — OPEN, P0),
       148 (RETRO-024 — FOLLOW-141 AC2 + AC3 carry-forward: corpus harness scoring + L1-L7 ladder doc — OPEN),
       149 RESERVED for FOLLOW-149 / PR #166 (RETRO-026, parallel — not consumed by RETRO-025),
       150 (RETRO-025 — close FOLLOW-143 AC1 integration test + reconcile §13.2 dpia.md:1017 dual-id narrative + sweep stale comment + dual-id docblock).
     - NEXT FREE FOLLOW NUMBER IS 151 (assuming RETRO-026 consumes only what its findings need; RETRO-025 did not consume 149). -->
<!-- AUTHORITATIVE NUMBERING LEDGER (updated 2026-05-28 after RETRO-023 / PR #164 — first Sprint 13a-hardening-v2 retro):
     - RETRO coverage: ...RETRO-019=PR#159/FOLLOW-129 (Sprint 13a-hardening, 1st of 4),
       RETRO-020=PR#160/FOLLOW-128 (Sprint 13a-hardening, 2nd of 4),
       RETRO-021=PR#161/FOLLOW-127 (Sprint 13a-hardening, 3rd of 4),
       RETRO-022=PR#162/FOLLOW-122 (Sprint 13a-hardening, 4th & FINAL),
       RETRO-023=PR#164/FOLLOW-139 (Sprint 13a-hardening-v2, 1st of 2). Next retro = RETRO-024
       (2nd of 2: PR#165/FOLLOW-141).
     - FOLLOW numbers consumed: ...139 (RETRO-019), 140 (RETRO-020),
       141 (RETRO-021), 142 (RETRO-022),
       143 (RETRO-023 — wire getOrCreateCrossSessionId into init), 
       144 (RETRO-023 — reconcile "monthly"/"30 days" cadence claim with 90-day TTL),
       145 (RETRO-023 — Withdraw button UI affordance),
       146 (RETRO-023 — thread xid onto event wire / ingest join key).
     - NEXT FREE FOLLOW NUMBER IS 147. -->
<!-- AUTHORITATIVE NUMBERING LEDGER (updated 2026-05-27 after RETRO-021 / PR #161):
     - RETRO coverage: ...RETRO-017=PR#157/FOLLOW-114, RETRO-018=PR#158/FOLLOW-118-121 (YELLOW Sprint 1),
       RETRO-019=PR#159/FOLLOW-129 (Sprint 13a-hardening, 1st of 4),
       RETRO-020=PR#160/FOLLOW-128 (Sprint 13a-hardening, 2nd of 4),
       RETRO-021=PR#161/FOLLOW-127 (Sprint 13a-hardening, 3rd of 4). Next retro = RETRO-022
       (4th of 4: PR#162/FOLLOW-122).
     - FOLLOW numbers consumed: ...127 (RETRO-017), 128-131 (RETRO-018), 132-138 RESERVED
       (YELLOW Sprint 2-4 stubs), 139 (RETRO-019), 140 (RETRO-020),
       141 (RETRO-021 — pilot-row inquiry_submit_selector population + corpus accuracy).
     - NEXT FREE FOLLOW NUMBER IS 142. -->
<!-- AUTHORITATIVE NUMBERING LEDGER (updated 2026-05-27 after the 6-PR merge-wave retros):
     - RETRO coverage: RETRO-010=PR#150/FOLLOW-105, RETRO-011=PR#151/FOLLOW-097,
       RETRO-012=PR#152/FOLLOW-106, RETRO-013=PR#153/FOLLOW-094, RETRO-014=PR#154/FOLLOW-093,
       RETRO-015=PR#155/FOLLOW-098, RETRO-016=PR#156/FOLLOW-117, RETRO-017=PR#157/FOLLOW-114,
       RETRO-018=PR#158/FOLLOW-118-121 (YELLOW Sprint 1),
       RETRO-019=PR#159/FOLLOW-129 (Sprint 13a-hardening, 1st of 4),
       RETRO-020=PR#160/FOLLOW-128 (Sprint 13a-hardening, 2nd of 4). Next retro = RETRO-021
       (3rd of 4: PR#161/FOLLOW-127; then 4th: PR#162/FOLLOW-122).
     - FOLLOW numbers consumed: 116-117 (RETRO-012); 118-121 RESERVED for YELLOW Sprint 1 (QUEUE.md);
       122 (RETRO-013), 123-124 (RETRO-014), 125-126 (RETRO-016), 127 (RETRO-017),
       128-131 (RETRO-018), 132-138 RESERVED (YELLOW Sprint 2-4 stubs), 139 (RETRO-019),
       140 (RETRO-020 — §13.1 7-day audit-log retention enforcement). RETRO-020 did NOT
       re-file §13.2 (covered by FOLLOW-139); RETRO-015 created no new stub (folded into FOLLOW-122).
     - NEXT FREE FOLLOW NUMBER IS 141. -->
