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

<!-- RETRO-002 and beyond will be appended here by the retrospective-analyst agent -->
