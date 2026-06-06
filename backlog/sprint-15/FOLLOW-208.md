# FOLLOW-208 — Listing-view RATE as portfolio_builder/flip_investor signal

**Sprint:** 15 **Agent:** sdk-engineer **Priority:** P2 **Estimated hours:** 3 **Status:** READY
**Source:** Audit §3 gap analysis (2026-06-05) **Promoted:** 2026-06-06

---

## Context

Currently `listing.viewed` counts page views but ignores rate. Portfolio_builder and flip_investor
exhibit high-velocity comparison shopping: many listings in a short time, short dwell per listing.
Family_buyer and first_time_buyer browse few listings with long dwell. Rate (views/elapsed_time) is
one of the strongest behavioral discriminators not currently wired.

## Scope

- In `packages/sdk/src/index.ts`: track `sessionStartedAt` (timestamp at init) alongside
  `listingViewCount` (already tracked for quiz trigger).
- Add `applyListingViewRate(state, viewCount, elapsedMs)` pure function to
  `packages/sdk/src/core/intent.ts`. Compute rate = `viewCount / (elapsedMs / 60000)` (views per
  minute). Apply likelihood updates:
  - rate ≥ 3 views/min → portfolio_builder +0.12, flip_investor +0.08, neutral -0.10
  - rate ≤ 0.5 views/min + viewCount ≥ 2 → family_buyer +0.06, first_time_buyer +0.06, upsizer +0.04
- Call `applyListingViewRate()` inside the `listing.viewed` observer callback (in addition to
  existing behavioral signal update), but only when `viewCount ≥ 2` (first view is baseline).
- Include `listing_view_rate` (float, views_per_minute) in the `session.quality.snapshot` ingest
  payload for analytics.

## Acceptance criteria

- [ ] AC1: `applyListingViewRate()` pure function, tested with mock timing scenarios
- [ ] AC2: Rate ≥3 views/min correctly boosts portfolio_builder confidence in unit tests
- [ ] AC3: Rate logged in session quality snapshot
- [ ] AC4: Tests pass, CI green

## Definition of Done

- [ ] Branch `sdk-engineer/FOLLOW-208-listing-view-rate`; commits referencing [FOLLOW-208]; PR
      opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [] · **produces:** [high-velocity browsing as portfolio_builder/flip_investor
discriminator, listing_view_rate in MOAT analytics]
