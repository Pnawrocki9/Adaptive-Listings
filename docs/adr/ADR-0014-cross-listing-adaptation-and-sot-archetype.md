# ADR-0014: Cross-listing adaptation in SPA hosts + source-of-truth archetype persistence

## Status

ACCEPTED — 2026-06-22 (CEO-directed, verified end-to-end against the real `app.estalara.com`
SvelteKit listing flow with a real browser). Extends ADR-0008 (detection→adaptation bridge),
ADR-0009 (per-listing LLM headline), ADR-0010 (archetype-fit gate / neutral verdict), and the intent
engine (FOLLOW-344 switch-margin, FOLLOW-208 listing-view-rate, FOLLOW-101 chat-intent prior).
Relates to FOLLOW-199/201 (quiz), FOLLOW-176 (intent persistence).

## Context

The SDK was architected on the implicit assumption that **one listing = one full page load**. On a
real single-page-application host (`app.estalara.com` is SvelteKit; React/Vue tenants behave the
same) that assumption breaks in two distinct ways. Both were reproduced live in the browser this
session, and both silently turned OFF adaptation on the 2nd+ listing while leaving the 1st listing
working — exactly the symptom reported ("pierwszy listing działa, kolejne już nie").

### Problem 1 — listing changes were never detected on client-side navigation

`init()` runs **once** per document load. On SPA navigation between listings:

- SvelteKit **reuses the same DOM node** for the listing root and mutates `data-estalara-listing-id`
  **in place** (confirmed: a JS marker set on the element survived navigation; only the attribute
  value changed A→B). It does NOT remount the subtree.
- The `<script async>` SDK loader is **never re-fetched** on SPA navigation, so a freshly deployed
  bundle does not take effect until the next full page load.

The original `IntersectionObserver` only observed elements present at `init()` time and only fired
on a visibility-threshold crossing. An in-place attribute mutation produced **no** `listing.viewed`
event → `refreshDirectives()` never ran for the new listing → the page kept the previous listing's
adapted copy. A second bug compounded it: `listing.viewed` read `dataset.listingId`, but
`data-estalara-listing-id` maps to `dataset.estalaraListingId`, so `listing_id` was always `''`.

### Problem 2 — the resolved archetype decayed to `neutral` mid-session

Once the quiz resolves an archetype (e.g. `family_buyer` @ 0.85), every routine behavioral signal
(`scroll.depth`, `listing.viewed`, and especially `applyListingViewRate` — FOLLOW-208, where rapid
multi-listing viewing pushes toward investor archetypes) multiplies probability mass toward
`neutral`. The `SWITCH_MARGIN = 0.05` hysteresis only slows this. After enough signals the argmax
flips to `neutral`; `archetype_hint: 'neutral'` is sent; the decision API correctly returns a
no-directive response (cold-start contract) → adaptation silently stops. Verified: after a normal
multi-listing browse the persisted state was `{ archetype: 'neutral', quiz_answered: true }`.

### CEO ruling (2026-06-22) on archetype drift

Drift away from the quiz-declared archetype is **legitimate but directional**:

- **Allowed:** drift to a _different non-neutral_ archetype when navigation and/or chat questions
  make it evident the buyer's true need differs from what they declared in the quiz (e.g. a declared
  `family_buyer` who keeps asking about rental yield → `yield_hunter`).
- **Forbidden:** silent decay to `neutral`, which is not a "different need" — it is the absence of a
  signal and must never turn adaptation off mid-session.

Additional constraint: if a tenant **disables the quiz**, the system must remain fully functional
(adaptation driven by behavioral + chat signals), and the same anti-neutral-decay guarantee applies.

## Decision

### 1. Detect listing changes robustly in SPA hosts (`observer.ts`, `index.ts`)

- The behavioral observer now also runs a `MutationObserver` on `document.body`
  (`childList + subtree + attributes`, `attributeFilter: ['data-estalara-listing-id']`). Both
  framework navigation shapes **emit `listing.viewed` directly** (not via the
  `IntersectionObserver`):
  - **childList** — the framework unmounts+remounts the listing component (a new DOM node), e.g.
    navigating listing → browse page → listing. The `IntersectionObserver` (`threshold: 0.5`) can
    **never** fire here: a listing DETAIL root is taller than the viewport, so 50% is never visible.
    Relying on it left remount-style navigation completely unadapted until a full reload — the
    primary user-reported regression. We now emit `listing.viewed` the moment the listing root is
    added.
  - **attributes** — the framework reuses the same node and updates `data-estalara-listing-id` in
    place (SvelteKit same-component navigation between slugs); emit directly, because the
    `IntersectionObserver` already `unobserve`d the reused node after its first view.
- `listing.viewed` reads `getAttribute('data-estalara-listing-id')` (correct) instead of
  `dataset.listingId` (always empty).
- `init()` tracks both `previousListingId` **and the listing-root node identity**. It re-adapts when
  the id changed (in-place nav) OR the root node itself changed (remount of the same listing via a
  browse page / back button — a new node carrying the same id). On a change it calls
  `resetAdaptState()`, tears down stale description observers, restores the original headline, then
  `refreshDirectives()`.

### 2. Source-of-truth (SoT) archetype, anti-neutral-decay (`session.ts`, `index.ts`, `intent.ts`)

- A new sessionStorage value, `estalara_resolved_archetype_<sessionId>`, holds the **latest
  non-neutral** archetype the engine has resolved. It is **seeded by the quiz answer** and then
  **updated on every `refreshDirectives()` that resolves a non-neutral archetype** (post chat-intent
  prior). So the SoT always tracks the most recently _evident_ need — quiz first, then chat /
  sustained behavioral evidence.
- In `refreshDirectives()`, **before** the decision call: if the live archetype is `neutral`, re-pin
  it to the persisted SoT for this fetch. A non-neutral live archetype is left untouched — drift to
  another real archetype is honored; only neutral-decay is reversed.
- `classifyFromProbabilities()` gained an optional `quizAnswered` flag (passed by the behavioral
  signal paths): when set, a drift whose argmax is `neutral` holds the current non-neutral
  archetype, keeping the in-memory/persisted `IntentState` consistent with the hint that is sent.
- The SoT value is sessionStorage (tab-lifetime), consent-gated like `persistIntentState`, and
  erased alongside the intent state on consent denial (`eraseIntentState`) — Mode A compliance.

### 3. `neutral` stays valid per-listing; non-fitting listings show the original (`adapt.ts`, `index.ts`)

`neutral` is a legitimate, expected outcome in two cases, and both must render the tenant's
**original** copy:

1. **No signal** — cold start with no quiz and no resolved SoT: the hint is `neutral`, the decision
   API returns no directive, the page is left as-is.
2. **Archetype-fit mismatch** — the buyer IS assigned a non-neutral archetype, but the _specific
   listing_ does not fit it (the per-listing archetype-fit gate, ADR-0010, returns a neutral verdict
   — e.g. `family_buyer` on a luxury high-rise). The session archetype is unchanged; only _this_
   listing is not adapted.

The per-listing fit decision lives server-side; the SDK sends the session archetype as the hint and
the decision API decides per listing. The SDK must then actually show the original, which on a
reused SPA DOM node it previously did not. Two SDK fixes close that gap:

- `applyTextDirective` **never blanks a slot**: an empty/whitespace directive value (the gate's "no
  adaptation" signal) is skipped, not applied — applying it would erase the original headline.
- On cross-listing navigation the SDK reverts adapted slots to their original **before**
  re-adapting: it tears down the per-slot description observers first (so the framework's
  freshly-rendered per-listing description stands), then restores the captured original headline
  placeholder. If the new listing IS a fit, `refreshDirectives()` re-applies adaptation on top; if
  it is not, the original copy remains. Net: a fitting listing adapts, a non-fitting listing shows
  the original — verified C(fit)→D(non-fit)→B(fit)→C(fit) with the headline correctly reverting to
  the placeholder on D and re-adapting on the others.

### 4. Quiz-disabled parity

The SoT mechanism is **not** gated on `quiz_answered`. A quiz-disabled tenant
(`config.quiz.enabled === false`) seeds and updates the SoT purely from behavioral/chat resolution,
so cross-listing adaptation and anti-neutral-decay work identically without the quiz.

### 5. Quiz-completion suppression is session-scoped (`quiz-trigger.ts`)

The "quiz already taken → don't re-prompt" flag (`__estalara_quiz_completed__`) moved from
**permanent localStorage** to **sessionStorage**. It must match the lifetime of what it produces:
the resolved archetype lives in sessionStorage (Mode A — no cross-session profiling without
re-consent). A permanent flag suppressed the quiz forever while the archetype was wiped on the next
session, stranding a returning visitor on `neutral` with no way to re-declare — and, in practice,
made the quiz "stop appearing" across an incognito session after one completion. Now: within a
session the quiz is not re-shown (survives in-tab navigation and same-tab reload); a new tab /
window / session shows it again, in lockstep with the session-scoped archetype.

## Consequences

- Cross-listing adaptation fires on every SPA navigation; each listing receives its own
  archetype-grounded copy (verified across 4 real listings, multiple navigation orders).
- The resolved archetype survives routine browsing and full reload; it only changes to another
  _non-neutral_ archetype, never silently to `neutral`.
- A genuine investor-signal drift (e.g. rapid multi-listing browsing → `portfolio_builder`) still
  takes over — this is the CEO-sanctioned "evident true need overrides the declaration" path. The
  archetype-fit gate (ADR-0010) still returns neutral/original copy for listings the archetype does
  not fit (e.g. `family_buyer` on a Miami high-rise), so no hallucinated adaptation is forced.
- **Production dependency (see `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md`):** the host page MUST
  update `data-estalara-listing-id` in place on SPA navigation, and the SDK bundle MUST be served
  with a cache strategy that lets a redeploy take effect (the `<script async>` loader is not
  re-fetched on SPA navigation). These are the only items that require Rafał's action; the decision
  API already honors `archetype_hint` + the neutral cold-start contract.

## Verification

End-to-end via a real browser (Kimi WebBridge) against `localhost:5173` (real SvelteKit app) + local
decision mock with live LLM (Haiku 4.5):

- Realistic browse over 4 listings after a `family_buyer` quiz → **8/8** `archetype_hint` =
  `family_buyer`, never `neutral`; each fitting listing rendered its own family-grounded headline +
  description.
- **Remount-style navigation** (listing → `/en` browse page → listing, and same-listing remount):
  the new listing adapts within ~1 s without a reload. This was the regression where the original
  `IntersectionObserver`-gated path left every browse-page navigation unadapted until a manual
  refresh.
- Quiz re-appears in a fresh session even when the legacy permanent `localStorage` completion flag
  is still set (the check now reads sessionStorage).
- Archetype-fit mismatch: `family_buyer` on the Miami high-rise rendered the **original** headline
  placeholder ("Discover what makes this property a standout opportunity.") — not blank, not the
  previous listing's adapted copy — while fitting listings kept adapting; verified
  C(fit)→D(non-fit)→B(fit)→C(fit).
- Survives full page reload (`estalara_resolved_archetype_* = family_buyer` rehydrated).
- All touched SDK suites pass (`adapt`, `intent`, `session`, weights, snapshot, switch-margin). The
  only two repo-wide failures (`QUIZ_TRIGGER_DELAY_MS` expected 30s) are pre-existing and unrelated
  — a local demo change set the trigger delay to 0; not introduced by this work.
