# FOLLOW-194 — SDK quick fixes batch (F-01, F-08, F-13, F-15, F-16)

**Sprint:** 15 **Agent:** sdk-engineer (F-01/F-08/F-13/F-15) + backend-engineer (F-16) **Priority:**
P1 **Estimated hours:** 5 **Status:** READY **Source:** Audit F-01, F-08, F-13, F-15, F-16
**Promoted:** 2026-06-05

---

## Context

Five small standalone bugs in the SDK and control-plane, each independently addressable. Batched
into a single PR for efficiency. All are S-effort (15 min to 1h each). These are Track A (Week 1)
fixes that unblock correct signal collection, grounding, and DOM adaptation from day one of the
pilot.

**F-01** (`events.ts:54`): `consent_state` is hardcoded to `'legitimate-interest'` even when the
user has explicitly consented. GDPR audit trail broken.

**F-08** (`index.ts:232`): `pageType: 'listing_list'` hardcoded. On a listing detail page the server
always returns ReorderDirective (grid-view type) instead of slot directives.

**F-13** (`index.ts:232`): `listing_id` (singular) never sent in adapt request body from
`fetchDirectives()`. Per-listing RAG context silently never activates on detail pages.

**F-15** (`index.ts:230–276`): `resetAdaptState()` called on every `refreshDirectives()` — every ~30
seconds of engagement. Causes visible text flicker every 30s.

**F-16** (`route.ts:838`): `getDemoOverride()` called twice in the same handler. Two DB/Redis reads
for the same value on every adapt request in demo mode.

## Scope

Single PR with five focused fixes:

- **F-01** — `packages/sdk/src/core/events.ts:54`: map `getConsentState()` result to the correct
  ingest enum: `'granted' → 'consented'`, `'pending' → 'legitimate-interest'`, `'denied' → 'none'`.
- **F-08** — `packages/sdk/src/index.ts:232`: detect `pageType` from URL pattern (e.g., `/listing/`
  → `'listing_detail'`, else `'listing_list'`). Or read from `data-page-type` attribute on the
  `<script>` tag if present. Document the detection logic.
- **F-13** — `packages/sdk/src/index.ts:232`: read `data-estalara-listing-id` from the listing
  detail page element (or the `<script>` tag attribute) and set `body.listing_id` in the adapt
  request.
- **F-15** — `packages/sdk/src/index.ts:230–276`: store previous archetype (e.g.,
  `let previousArchetype: string | null = null`). Call `resetAdaptState()` only when
  `resp.archetype !== previousArchetype`. Update `previousArchetype` after each response.
- **F-16** — `apps/control-plane/src/app/api/adapt/route.ts:838`: store the first
  `getDemoOverride()` result in a variable and reuse it; remove the second call.

## Acceptance criteria

- [ ] AC1: F-01: `consent_state` in ingest payloads reflects `'consented'` for users who granted
      consent, `'legitimate-interest'` for pending/unasked, `'none'` for denied. Unit test covers
      all three cases.
- [ ] AC2: F-08: `pageType` is correctly `'listing_detail'` on a listing detail URL and
      `'listing_list'` on a grid URL. Unit test covers URL pattern detection.
- [ ] AC3: F-13: adapt request body includes `listing_id` when `data-estalara-listing-id` is present
      on the page. Unit test covers this.
- [ ] AC4: F-15: `resetAdaptState()` is NOT called when the archetype has not changed between
      `refreshDirectives()` cycles. Only called on archetype change. Unit test confirms.
- [ ] AC5: F-16: `getDemoOverride()` called exactly once per handler invocation in demo mode. No
      second call.
- [ ] AC6: All 5 changes in a single PR; CI green.

## Definition of Done

- [ ] Branch `sdk-engineer/FOLLOW-194-sdk-quick-fixes`; commits referencing [FOLLOW-194]; PR opened;
      CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [] · **produces:** [correct GDPR consent logging, correct page-type directives, no
flicker]
