# FOLLOW-191 — Implement data-estalara-slot hooks in local Estalara-app

**Sprint:** 15 **Agent:** sdk-engineer **Priority:** P0 **Estimated hours:** 4 **Status:** READY
**Source:** Audit F-02, §E.2.3 **Promoted:** 2026-06-05

---

## Context

DOM adaptation in the SDK relies on `document.querySelectorAll('[data-estalara-slot="..."]')` in
`packages/sdk/src/core/adapt.ts:311`. CHK-B confirmed zero such elements exist on `app.estalara.com`
at time of audit. The `adapt.applied` event never fires; `adapt.skipped` fires instead with
`reason: 'no_slot_elements'`. **The entire adaptation layer is invisible to users until this is
resolved.** Without confirmed `data-estalara-slot` hooks in production on `app.estalara.com`, the
pilot measures no adapted experience.

Two possible outcomes:

1. `PUBLIC_ESTALARA_SDK_ENABLED=true` is already set in Estalara-app production — verify and
   confirm.
2. It is not yet deployed — deploy the listing detail template with `data-estalara-slot` hooks in
   the Estalara-app repo (separate SvelteKit repo, not this one).

This is a Track A (Week 1) blocker. No real traffic can be measured as adapted until this lands.

## Scope

- Verify `PUBLIC_ESTALARA_SDK_ENABLED=true` is set in Estalara-app production environment
  (`.env.production` or hosting environment).
- Verify `data-estalara-slot="headline"`, `data-estalara-slot="description"`, and
  `data-estalara-slot="cta"` are present in the rendered HTML of a live listing detail page on
  `app.estalara.com`.
- If slots are NOT present: deploy the listing detail page template in the Estalara-app repo with
  the required `data-estalara-slot` attribute hooks. Work in the Estalara-app repo (local disk, no
  GitHub push access from this repo).
- Verification method: `curl -s https://app.estalara.com/[any-listing-detail-url]` or browser
  DevTools confirms `data-estalara-slot="headline"` in the DOM.
- Document the result in the PR description with evidence (curl output or screenshot confirming slot
  presence).

## Acceptance criteria

- [ ] AC1: `data-estalara-slot="headline"` is confirmed present in the production DOM on at least
      one `app.estalara.com` listing detail page.
- [ ] AC2: `data-estalara-slot="description"` and `data-estalara-slot="cta"` are also present (or
      documented why only headline is required for initial pilot).
- [ ] AC3: `PUBLIC_ESTALARA_SDK_ENABLED=true` confirmed in the Estalara-app production environment.
- [ ] AC4: PR description includes evidence (curl snippet or screenshot) confirming the DOM hooks
      are live.

## Definition of Done

- [ ] Branch `sdk-engineer/FOLLOW-191-verify-deploy-dom-hooks`; commits referencing [FOLLOW-191]; PR
      opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [] · **produces:** [FOLLOW-197 (SDK event listeners can now fire adapt.applied)]
