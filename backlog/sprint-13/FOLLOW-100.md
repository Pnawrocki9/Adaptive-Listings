# FOLLOW-100 — SIGNAL_LIKELIHOODS all 18 archetypes + CHAT_INTENT_LIKELIHOODS + applyChatIntentPrior()

**Agent:** sdk-engineer  
**Priority:** P1  
**Estimated hours:** 8  
**Depends on:** FOLLOW-099 (DONE — PR #248)  
**Branch:** `sdk-engineer/FOLLOW-100-signal-likelihoods`  
**Model:** opus-4.8 (extended thinking — likelihood calibration + Bayesian math)

---

## Context

`packages/sdk/src/core/intent.ts` contains the Bayesian archetype engine. FOLLOW-099 shipped
behavioral observers (photo.dwell, feature.expanded, mortgage_calc.used, filter.applied enriched,
inquiry.started). FOLLOW-100 completes the likelihood calibration so those signals actually
discriminate archetypes.

Per Master Design §D.6 the target is **≥13/18 archetypes at 🟢 Full coverage** after this ticket.

---

## Acceptance Criteria

### AC-1: Missing SIGNAL_LIKELIHOODS entries

Add entries to `SIGNAL_LIKELIHOODS` in `intent.ts` for every signal in the §D.6 behavioral column
that is not yet wired. Required additions:

| Signal               | Likelihood values (raw, before BEHAVIORAL_DAMPING)                                                |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `photo.dwell`        | `luxury_buyer: 1.15, second_home_buyer: 1.12, lifestyle_expat: 1.08, neutral: 0.88`               |
| `feature.expanded`   | Base entry: `neutral: 0.85` — payload-conditional intercept in `applyBehavioralSignal` (see AC-2) |
| `mortgage_calc.used` | `family_buyer: 1.2, first_time_buyer: 1.25, upsizer: 1.1, neutral: 0.8`                           |
| `price.compared`     | `flip_investor: 1.2, yield_hunter: 1.1, portfolio_builder: 1.08, neutral: 0.85`                   |
| `inquiry.started`    | `neutral: 0.7` (high general intent — no archetype discriminator alone)                           |

Note: `dwell.time` is already handled via `applyListingViewRate()` + `DWELL_BASE_BOOST` — do NOT add
a static SIGNAL_LIKELIHOODS entry for it; the existing path is correct.

### AC-2: feature.expanded payload-conditional intercept

Add an intercept in `applyBehavioralSignal()` for `feature.expanded` (analogous to the existing
`filter.applied` and `listing.bookmarked` intercepts). The intercept reads `payload.feature`
(string) and applies multiplicative boosts:

| `payload.feature` value                  | Archetype boosts                                                |
| ---------------------------------------- | --------------------------------------------------------------- |
| `yield` / `str` / `rental_yield`         | `vacation_rental_investor *= 1.3, yield_hunter *= 1.15`         |
| `legal` / `visa` / `golden_visa`         | `golden_visa_buyer *= 1.35, lifestyle_expat *= 1.1`             |
| `home_office` / `workspace` / `internet` | `remote_worker *= 1.4`                                          |
| `accessibility`                          | `downsizer *= 1.2, retiree_relocator *= 1.15`                   |
| `climate`                                | `retiree_relocator *= 1.2, lifestyle_expat *= 1.1`              |
| `expat` / `international` / `foreign`    | `lifestyle_expat *= 1.3, diaspora_buyer *= 1.15`                |
| _(unrecognized)_                         | no boost — apply base neutral-push from SIGNAL_LIKELIHOODS only |

### AC-3: Missing filter facets in applyFilterBoosts

Extend `applyFilterBoosts()` with the following facet rules (additive boosts, same pattern as
existing `commercial`/`investment_yield`/`bedrooms`):

| facet                                 | value condition                     | Archetype boost                                |
| ------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `renovation`                          | any                                 | `flip_investor += 0.15`                        |
| `type`                                | `holiday` / `vacation`              | `vacation_rental_investor += 0.18`             |
| `price_max`                           | numeric ≤ 300_000 (or string `low`) | `first_time_buyer += 0.12`                     |
| `bedrooms_min`                        | numeric ≥ 4                         | `upsizer += 0.12`                              |
| `bedrooms_max`                        | numeric ≤ 2                         | `downsizer += 0.12`                            |
| `near_university` / `school_district` | any                                 | `student_parent += 0.15, family_buyer += 0.08` |

### AC-4: CHAT_INTENT_LIKELIHOODS constant

Add `const CHAT_INTENT_LIKELIHOODS` to `intent.ts`. This is a
`Record<string, ArchetypeProbabilities>` keyed by `"dimension=value"` strings matching the 12-dim
chat intent vector from FOLLOW-087.

Implement exactly the mapping from Master Design §D.1.1:

```
purchase_purpose=investment        → yield_hunter:0.7, vacation_rental_investor:0.6, flip_investor:0.6, portfolio_builder:0.7, golden_visa_buyer:0.5, commercial_investor:0.5
purchase_purpose=second_home       → second_home_buyer:0.85, lifestyle_expat:0.4
purchase_purpose=vacation_rental   → vacation_rental_investor:0.9
purchase_purpose=retirement        → retiree_relocator:0.85, downsizer:0.5
purchase_purpose=relocation        → lifestyle_expat:0.7, remote_worker:0.6, retiree_relocator:0.4
cross_border=foreign_buyer         → golden_visa_buyer:0.7, lifestyle_expat:0.6, diaspora_buyer:0.4
cross_border=expat_returning       → diaspora_buyer:0.85
family_stage=young_family          → family_buyer:0.8, student_parent:0.4
family_stage=established_family    → family_buyer:0.7, upsizer:0.5
family_stage=empty_nester          → downsizer:0.75, retiree_relocator:0.3
family_stage=retiree               → retiree_relocator:0.85, downsizer:0.6
finance_complexity=investment_vehicle → yield_hunter:0.6, golden_visa_buyer:0.6, commercial_investor:0.5
finance_complexity=standard_mortgage  → first_time_buyer:0.7, family_buyer:0.4
urgency=0-3mo + purchase_purpose=investment → flip_investor:0.8 (compound key — see below)
urgency=12mo+ + purchase_purpose=investment → portfolio_builder:0.7
geo_priority=school_district       → family_buyer:0.7, student_parent:0.6
feature_priority=workspace         → remote_worker:0.85
budget_band=comfortable + purchase_purpose=primary → luxury_buyer:0.6
tax_aware=true                     → yield_hunter:0.4, golden_visa_buyer:0.5, vacation_rental_investor:0.4
```

For compound keys (`urgency=0-3mo + purchase_purpose=investment`), implement as two separate
single-dimension keys that are each applied when present. The compound boost from the D.1.1 table
maps to the dominant archetype of the compound case. Specifically:

- `urgency=0-3mo` alone → `flip_investor: 0.6, yield_hunter: 0.5`
- `urgency=12mo+` alone → `portfolio_builder: 0.6, yield_hunter: 0.5`

For any dimension value not listed → no entry (no boost).

Use `makeLikelihood()` to build each entry so missing archetypes default to 1.0.

### AC-5: applyChatIntentPrior() function

Add
`export function applyChatIntentPrior(state: IntentState, intentDimensions: Record<string, string>): IntentState`.

- `intentDimensions` is a flat object e.g.
  `{ purchase_purpose: 'investment', urgency: '0-3mo', tax_aware: 'true' }`
- For each `dimension: value` pair, look up `CHAT_INTENT_LIKELIHOODS[dimension + '=' + value]`
- Apply each found likelihood multiplicatively (NOT damped — chat intent has same weight as quiz per
  §D.7: `QUIZ_CONFIDENCE_BONUS` applies)
- After all dimensions applied: normalize, classify, set
  `confidence = min(rawConfidence * QUIZ_CONFIDENCE_BONUS, 1.0)`
- Do NOT set `quiz_answered = true` (chat is a separate source)
- If `chat_confidence > 0.7` AND `state.quiz_answered` AND leading archetype differs from current
  `state.archetype` by > `MISMATCH_GAP_THRESHOLD` → emit mismatch metadata in the returned state via
  a new optional field `chat_mismatch?: { quiz_archetype: Archetype; chat_archetype: Archetype }` on
  `IntentState`. Add this field to the `IntentState` type.
- If `intentDimensions` is empty → return state unchanged

### AC-6: D.7 coverage verification — ≥13/18 Full

After implementing AC-1 through AC-5, verify the §D.6 coverage matrix by checking that the following
archetypes have ≥2 discriminating signal paths (behavioral OR quiz OR chat):

🟢 Required Full (≥2 paths): `yield_hunter`, `vacation_rental_investor`, `flip_investor`,
`portfolio_builder`, `family_buyer`, `first_time_buyer`, `upsizer`, `downsizer`, `luxury_buyer`,
`remote_worker`, `lifestyle_expat`, `second_home_buyer`, `neutral` = 13 archetypes.

🟡 Acceptable Quiz-only: `retiree_relocator`, `diaspora_buyer`, `student_parent`.

⚪ Acceptable Chat-only: `golden_visa_buyer`, `commercial_investor`.

### AC-7: Tests

Add / extend tests in `packages/sdk/src/__tests__/intent.test.ts`:

1. **SIGNAL_LIKELIHOODS tests** — for each new signal: one test that calling `applyBehavioralSignal`
   with the event type + representative payload shifts probability toward the expected archetype.

2. **feature.expanded intercept** — at least 4 tests covering different `payload.feature` values
   (e.g. `home_office` → remote_worker boosts, `yield` → vacation_rental_investor boosts).

3. **applyFilterBoosts** — tests for each new facet (renovation, type=holiday, price_max=low,
   bedrooms_min≥4, bedrooms_max≤2, near_university).

4. **applyChatIntentPrior** — at minimum:
   - `purchase_purpose=investment` → yield_hunter and portfolio_builder probability increases
   - `cross_border=expat_returning` → diaspora_buyer becomes dominant
   - `feature_priority=workspace` → remote_worker becomes dominant
   - Empty `intentDimensions` → state unchanged
   - Mismatch detection: quiz_answered=true with conflicting chat archetype emits `chat_mismatch`

5. Coverage target: `packages/sdk` must stay ≥80% after this ticket.

### AC-8: Export + types

- Export `applyChatIntentPrior` from `packages/sdk/src/core/intent.ts`
- Export `CHAT_INTENT_LIKELIHOODS` (for use in FOLLOW-101 bridge)
- Update `IntentState` type to include optional
  `chat_mismatch?: { quiz_archetype: Archetype; chat_archetype: Archetype }`
- Ensure all public API exports are reflected in `packages/sdk/src/index.ts` (check existing barrel)

---

## Implementation notes

- Do NOT change `BEHAVIORAL_DAMPING = 0.3` — per §D.7 it awaits calibration on real pilot data
  (FOLLOW-212)
- Do NOT change `QUIZ_CONFIDENCE_BONUS = 1.2` — chat NLP uses same weight intentionally
- `photo.dwell` receives the full BEHAVIORAL_DAMPING treatment (it's a soft behavioral signal, not a
  quiz-equivalent)
- `feature.expanded` intercept structure should mirror `listing.bookmarked` intercept:
  multiplicative base from SIGNAL_LIKELIHOODS, then payload-conditional multiplicative boosts
- Keep the existing `applyListingViewRate()` and `DWELL_BASE_BOOST` path for `dwell.time` — do not
  touch it

---

## Files to modify

- `packages/sdk/src/core/intent.ts` — all logic changes
- `packages/sdk/src/__tests__/intent.test.ts` — new test cases
- `packages/sdk/src/index.ts` — exports if needed

## PR requirements

- Branch: `sdk-engineer/FOLLOW-100-signal-likelihoods`
- Commit:
  `feat(sdk): SIGNAL_LIKELIHOODS + CHAT_INTENT_LIKELIHOODS + applyChatIntentPrior [FOLLOW-100]`
- CI must be green on all real gates (Build, Typecheck, Test, Format, rule-h, rule-j)
- `pnpm --filter @estalara/sdk test` coverage ≥80%
- `pnpm exec prettier --write` on all modified files before commit
