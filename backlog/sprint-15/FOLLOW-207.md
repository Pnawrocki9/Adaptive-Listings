# FOLLOW-207 — Referrer URL + device type session-init signals

**Sprint:** 15 **Agent:** sdk-engineer **Priority:** P2 **Estimated hours:** 3 **Status:** READY
**Source:** Audit §3 gap analysis (2026-06-05) **Promoted:** 2026-06-06

---

## Context

Two free signals available at session init that are currently ignored:

1. `navigator.referrer` + UTM query params — a user arriving from Google "investment property
   Warsaw" has a near-certain investor archetype before clicking anything. This is the
   highest-discriminating signal for cold sessions.
2. `navigator.userAgent` / window width — desktop (≥1024px) over-indexes for investor archetypes
   (portfolio_builder, yield_hunter, commercial_investor) because investors browse alongside
   spreadsheets. Mobile over-indexes for own-use buyers (family_buyer, first_time_buyer) doing "sofa
   scrolling." Weak alone but valuable as a prior multiplier.

## Scope

- In `packages/sdk/src/index.ts` (init phase, before `initIntentState()`): capture
  `document.referrer` and `window.location.search` (UTM params). Parse referrer hostname + path.
  Parse UTM `utm_term` and `utm_content` for keyword hints.
- Add `applyReferrerHints(state, referrer, utmTerm)` to `packages/sdk/src/core/intent.ts` (pure
  function, similar to existing `applyArchetypeHints`). Apply weak investment prior if referrer
  contains "investment", "rental", "yield", "inwestycja", "wynajem". Apply own-use prior if contains
  "family", "apartment", "mieszkanie", "dom".
- Add device type: `const isDesktop = window.innerWidth >= 1024`. Include as
  `device_type: 'desktop'|'mobile'` in ingest event payload at session start (`session.started`
  event schema).
- Add `device_type` to `SIGNAL_LIKELIHOODS` in `intent.ts` (weak: 0.05 delta for investor archetypes
  on desktop, 0.05 for own-use on mobile).
- Include `referrer_domain` and `device_type` in the `quiz.event` ingest payload for MOAT analysis.

## Acceptance criteria

- [ ] AC1: `applyReferrerHints()` is a pure function tested in isolation
- [ ] AC2: Investment-keyword referrers shift investor archetype priors by ≥0.03
- [ ] AC3: `device_type` logged in session.started ingest event
- [ ] AC4: `device_type` applied as prior multiplier in `SIGNAL_LIKELIHOODS`
- [ ] AC5: Tests pass, CI green

## Definition of Done

- [ ] Branch `sdk-engineer/FOLLOW-207-referrer-device-signals`; commits referencing [FOLLOW-207]; PR
      opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [] · **produces:** [richer cold-session archetype priors, device-type signal in MOAT
analytics]
