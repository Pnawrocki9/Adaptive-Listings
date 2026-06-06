# FOLLOW-211 — filter.applied full facet payload (FOLLOW-099 prerequisite)

**Sprint:** 15 **Agent:** sdk-engineer **Priority:** P1 **Estimated hours:** 2 **Status:** READY
**Source:** Audit §3 — filter.applied discriminating power is in the payload, not the event type
**Promoted:** 2026-06-06

---

## Context

FOLLOW-099 adds `filter.applied` as a new signal type. However, `filter.applied` without a rich
payload is nearly useless for archetype discrimination. A `filter.applied` event with
`{facet: "type", value: "commercial"}` is a near-certain `commercial_investor` signal. A
`filter.applied` with `{facet: "bedrooms_min", value: "3"}` combined with medium price range =
`family_buyer` with high probability. A sort by yield/ROI metrics = `yield_hunter`.

This ticket is a prerequisite for FOLLOW-099 to be architecturally useful — it defines the required
payload schema for `filter.applied` so that the likelihood updates in SIGNAL_LIKELIHOODS can be
facet-specific.

## Scope

- Define `FilterAppliedPayload` in `packages/shared/src/schemas/events/`:
  `{ facet: string, value: string|number, label?: string }` (facet = field name, value = selected
  value).
- Add `filter.applied` to `SIGNAL_LIKELIHOODS` in `packages/sdk/src/core/intent.ts` with conditional
  logic:
  - `facet === 'type' && value === 'commercial'` → `commercial_investor +0.20`, `neutral -0.15`
  - `facet === 'bedrooms_min' && value >= 3` → `family_buyer +0.10`, `upsizer +0.08`,
    `neutral -0.10`
  - `facet === 'sort' && (value includes 'yield' or 'roi')` → `yield_hunter +0.15`,
    `portfolio_builder +0.10`
  - `facet === 'price_max'` when value < median listing price → `first_time_buyer +0.08`,
    `downsizer +0.06`
- The conditional logic should be in the signal handler dispatch path (not the static
  SIGNAL_LIKELIHOODS table), using the payload passed to
  `applyBehavioralSignal(state, 'filter.applied', payload)`.
- Document the facet taxonomy for app.estalara.com so SDK integration can correctly populate the
  `facet` field.

## Acceptance criteria

- [ ] AC1: `FilterAppliedPayload` Zod schema defined and exported from
      `packages/shared/src/schemas/events/`
- [ ] AC2: `applyBehavioralSignal` with `filter.applied` + commercial facet correctly boosts
      `commercial_investor`
- [ ] AC3: `applyBehavioralSignal` with `filter.applied` + bedrooms ≥3 correctly boosts
      `family_buyer`
- [ ] AC4: Unit tests cover all 4 facet-conditional cases
- [ ] AC5: Tests pass, CI green

## Definition of Done

- [ ] Branch `sdk-engineer/FOLLOW-211-filter-applied-payload`; commits referencing [FOLLOW-211]; PR
      opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [] · **produces:** [FilterAppliedPayload Zod schema, facet-conditional
SIGNAL_LIKELIHOODS for filter.applied, prerequisite for FOLLOW-099]
