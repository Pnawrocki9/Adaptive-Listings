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

<!-- RETRO-006 and beyond will be appended here by the retrospective-analyst agent -->
