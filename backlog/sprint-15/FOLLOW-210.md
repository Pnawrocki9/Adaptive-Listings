# FOLLOW-210 — Favorites/bookmark capture: app.estalara.com save-listing event

**Sprint:** 15 **Agent:** sdk-engineer (Estalara-app repo) + sdk-engineer (this repo) **Priority:**
P1 **Estimated hours:** 5 **Status:** READY **Source:** Audit §3 (2026-06-05) — favorites identified
as highest-value deterministic intent signal **Promoted:** 2026-06-06

---

## Context

app.estalara.com has a favorites/save-listing feature. A user who saves a listing to favorites is
expressing high purchase intent and near-decision behavior. This is the single strongest available
deterministic signal outside of direct contact:

- Own-use buyers (family_buyer, upsizer, luxury_buyer, retiree_relocator) save listings they intend
  to revisit with a partner or return to
- Investors (yield_hunter, portfolio_builder) save listings for portfolio comparison spreadsheets
- The archetype of the saved listing (type, size, price range, location) provides direct archetype
  inference

The signal is currently invisible to the SDK. No CustomEvent is dispatched when a user adds a
listing to favorites on app.estalara.com.

## Scope — Part 1: Estalara-app CustomEvent (Estalara-app repo)

- Find the "add to favorites" / "save listing" action in `app.estalara.com` SvelteKit codebase. It
  is likely in `ListingCard.svelte` or `+page.svelte` for listing detail.
- Add on successful save:
  `window.dispatchEvent(new CustomEvent('estalara:listing:favorited', { detail: { listingId, listingType, priceRange, bedroomCount } }))`.
- Add on remove from favorites:
  `window.dispatchEvent(new CustomEvent('estalara:listing:unfavorited', { detail: { listingId } }))`.

## Scope — Part 2: SDK listener + ingest (this repo)

- In `packages/sdk/src/index.ts`: register `addEventListener('estalara:listing:favorited', ...)`.
- On event: (a) dispatch `listing.bookmarked` ingest event (already in schema:
  `packages/shared/src/schemas/events/` — verify `listing.bookmarked` exists or add it), (b) call
  `applyBehavioralSignal(state, 'listing.bookmarked', {listingType, priceRange, bedroomCount})`.
- Add `listing.bookmarked` to `SIGNAL_LIKELIHOODS` in `intent.ts`:
  - All archetypes at 1.0 baseline (neutral — saving a listing is positive intent but not
    archetype-specific on its own)
  - Boost `neutral: 0.70` (strong evidence of non-neutral intent → pushes away from neutral)
  - If `bedroomCount ≥ 3`: boost `family_buyer +0.15`, `upsizer +0.10`
  - If `listingType === 'commercial'` (if available in payload): boost `commercial_investor +0.20`
  - Payload-conditional logic handled inside the signal handler dispatch path, not in the static
    SIGNAL_LIKELIHOODS table

## Acceptance criteria

- [ ] AC1: CustomEvent fires on app.estalara.com when user adds listing to favorites (verified in
      browser console)
- [ ] AC2: SDK receives event and dispatches `listing.bookmarked` ingest event
- [ ] AC3: `applyBehavioralSignal` called with listing.bookmarked
- [ ] AC4: Neutral archetype probability decreases when listing.bookmarked fires
- [ ] AC5: Payload (listingType, bedroomCount) captured and usable for conditional boost logic
- [ ] AC6: Tests updated, CI green

## Definition of Done

- [ ] Branch `sdk-engineer/FOLLOW-210-favorites-capture`; commits referencing [FOLLOW-210]; PR
      opened; CI green.
- [ ] PM must run step 5d integration check: CustomEvent producer (Estalara-app Part 1) reaches SDK
      consumer (Part 2) in production code.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [] · **produces:** [listing.bookmarked ingest event, favorites as deterministic
intent signal, cross-repo CustomEvent bridge for save-listing action]
